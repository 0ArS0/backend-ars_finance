import { Injectable } from '@nestjs/common';
import { AccountKind, TransactionDirection } from '@prisma/client';
import { addDays, expandRecurringDates, toDateOnlyString } from '../common/utils/date.util';
import { toNumber } from '../common/utils/decimal.util';
import { buildProjection, ProjectionEvent, safeToSpend } from '../common/utils/finance.util';
import {
  isDespesaOutflow,
  isFaturamentoInflow,
  isPagamentoFaturaOutflow,
  isSalaryInflow
} from '../common/utils/inflow-classification.util';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectionQueryDto, SafeToSpendQueryDto, UpdateProjectionSettingsDto } from './dto/projection.dto';

@Injectable()
export class ProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async getProjection(userId: string, query: ProjectionQueryDto) {
    const startDate = query.startDate ? new Date(`${query.startDate}T00:00:00`) : new Date();
    startDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let days = query.days;
    let horizonEnd: Date;

    if (query.endDate) {
      horizonEnd = new Date(`${query.endDate}T00:00:00`);
      horizonEnd.setHours(0, 0, 0, 0);
      days = Math.max(Math.ceil((horizonEnd.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)), 1);
      days = Math.min(days, 1095);
      horizonEnd = addDays(startDate, days);
    } else {
      days = Math.min(Math.max(days, 1), 1095);
      horizonEnd = addDays(startDate, days);
    }

    const projectionStart = horizonEnd >= today ? today : startDate;
    const configuredMonthlyIncome = await this.getConfiguredMonthlyIncome(userId);
    const monthlyIncome = query.monthlyIncome !== undefined ? query.monthlyIncome : configuredMonthlyIncome;
    days = Math.max(Math.ceil((horizonEnd.getTime() - projectionStart.getTime()) / (1000 * 60 * 60 * 24)) + 1, 1);
    const events = await this.collectEvents(userId, projectionStart, horizonEnd, query.accountId);
    events.push(
      ...(await this.collectRevenueForecast(
        userId,
        projectionStart,
        horizonEnd,
        query.accountId,
        events,
        monthlyIncome
      ))
    );
    const startBalance = await this.getCurrentBalance(userId, query.accountId, projectionStart);
    const projection = buildProjection(startBalance, projectionStart, days, events);
    return projection;
  }

  async getSafeToSpend(userId: string, query: SafeToSpendQueryDto) {
    const startDate = new Date();
    const days = Math.max(
      Math.ceil((new Date(query.date).getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      1
    );
    const projection = await this.getProjection(userId, {
      days,
      accountId: query.accountId,
      monthlyIncome: query.monthlyIncome
    });
    return { date: query.date, amount: safeToSpend(projection, query.date) };
  }

  async getSettings(userId: string) {
    const settings = await this.prisma.appSetting.findUnique({ where: { userId } });
    return { monthlyIncome: settings?.monthlyIncome == null ? null : toNumber(settings.monthlyIncome) };
  }

  async updateSettings(userId: string, dto: UpdateProjectionSettingsDto) {
    const settings = await this.prisma.appSetting.upsert({
      where: { userId },
      create: { userId, monthlyIncome: dto.monthlyIncome ?? null },
      update: { monthlyIncome: dto.monthlyIncome ?? null }
    });
    return { monthlyIncome: settings.monthlyIncome == null ? null : toNumber(settings.monthlyIncome) };
  }

  async getRecurringSuggestions(userId: string, accountId?: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const threeMonthsAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));
    const previousMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const currentMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const transactions = await this.prisma.transaction.findMany({
      where: {
        direction: TransactionDirection.outflow,
        account: { userId },
        ...(accountId ? { accountId } : {})
      },
      include: {
        account: { select: { name: true, kind: true } },
        category: { select: { id: true, name: true, budgetType: true } }
      },
      orderBy: { transactionDate: 'asc' }
    });
    const existingRules = await this.prisma.recurringRule.findMany({
      where: { account: { userId } },
      select: { accountId: true, description: true }
    });
    const existingKeys = new Set(
      existingRules.map(
        (rule) => `${rule.accountId}:${this.normalizeDescription(this.cleanRecurringDescription(rule.description))}`
      )
    );
    const groups = new Map<
      string,
      {
        accountId: string;
        accountName: string;
        description: string;
        amounts: number[];
        dates: Date[];
        categoryIds: string[];
      }
    >();

    for (const transaction of transactions) {
      if (
        !isDespesaOutflow(transaction) ||
        this.isCardInvoice(
          transaction.description,
          transaction.notes,
          transaction.account.kind,
          transaction.category
        ) ||
        this.isTechnicalRecurringCandidate(transaction.description)
      ) {
        continue;
      }
      const description = this.cleanRecurringDescription(transaction.description);
      const normalized = this.normalizeDescription(description);
      const key = `${transaction.accountId}:${normalized}`;
      if (existingKeys.has(key)) continue;
      const group = groups.get(key) ?? {
        accountId: transaction.accountId,
        accountName: transaction.account.name,
        description,
        amounts: [],
        dates: [],
        categoryIds: []
      };
      group.amounts.push(toNumber(transaction.amount));
      group.dates.push(transaction.transactionDate);
      if (transaction.category?.id) group.categoryIds.push(transaction.category.id);
      groups.set(key, group);
    }

    return Array.from(groups.entries())
      .filter(([, group]) => {
        const months = new Set(group.dates.map((date) => `${date.getUTCFullYear()}-${date.getUTCMonth()}`));
        const recentDates = group.dates.filter((date) => date >= threeMonthsAgo && date <= today);
        const hasPreviousMonthOccurrence = group.dates.some(
          (date) => date >= previousMonth && date < currentMonth
        );
        return (
          group.dates.length >= 2 &&
          recentDates.length >= 2 &&
          months.size >= 2 &&
          group.dates.length <= months.size * 2 &&
          hasPreviousMonthOccurrence
        );
      })
      .map(([id, group]) => {
        const dayCounts = new Map<number, number>();
        for (const date of group.dates) {
          dayCounts.set(date.getUTCDate(), (dayCounts.get(date.getUTCDate()) ?? 0) + 1);
        }
        const dayOfMonth = Array.from(dayCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
        const categoryCounts = new Map<string, number>();
        for (const categoryId of group.categoryIds) {
          categoryCounts.set(categoryId, (categoryCounts.get(categoryId) ?? 0) + 1);
        }
        const categoryId = Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
        const amount = group.amounts[group.amounts.length - 1] ?? 0;
        const lastDate = group.dates[group.dates.length - 1];
        return {
          id,
          accountId: group.accountId,
          accountName: group.accountName,
          description: group.description,
          amount: Math.round(amount * 100) / 100,
          frequency: 'monthly' as const,
          dayOfMonth,
          startDate: toDateOnlyString(group.dates[0]),
          lastDate: toDateOnlyString(lastDate),
          occurrences: group.dates.length,
          categoryId: categoryId ?? null
        };
      })
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 20);
  }

  private async getCurrentBalance(userId: string, accountId?: string, asOfDate = new Date()) {
    const accounts = await this.prisma.financialAccount.findMany({
      where: accountId ? { id: accountId, userId } : { kind: { not: 'credit_card' }, userId }
    });
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    let balance = 0;
    for (const account of accounts) {
      const transactions = await this.prisma.transaction.findMany({
        where: {
          accountId: account.id,
          transactionDate: { lte: now }
        }
      });
      if (account.currentBalance != null) {
        balance += toNumber(account.currentBalance);
        if (asOfDate >= today) continue;
        for (const tx of transactions) {
          if (tx.transactionDate < asOfDate) continue;
          balance -= tx.direction === TransactionDirection.inflow ? toNumber(tx.amount) : -toNumber(tx.amount);
        }
      } else {
        balance += toNumber(account.openingBalance);
        for (const tx of transactions) {
          if (tx.transactionDate >= addDays(asOfDate, 1)) continue;
          balance += tx.direction === TransactionDirection.inflow ? toNumber(tx.amount) : -toNumber(tx.amount);
        }
      }
    }
    return balance;
  }

  private async collectRevenueForecast(
    userId: string,
    startDate: Date,
    horizonEnd: Date,
    accountId: string | undefined,
    existingEvents: ProjectionEvent[],
    monthlyIncome?: number
  ): Promise<ProjectionEvent[]> {
    if (monthlyIncome !== undefined) {
      return this.buildMonthlyIncomeForecast(startDate, horizonEnd, monthlyIncome, existingEvents);
    }

    const transactions = await this.prisma.transaction.findMany({
      where: {
        direction: TransactionDirection.inflow,
        transactionDate: { lt: startDate },
        account: { userId },
        ...(accountId ? { accountId } : {})
      },
      include: {
        account: { select: { kind: true } },
        category: { select: { name: true } }
      },
      orderBy: { transactionDate: 'asc' }
    });
    const recurringRules = await this.prisma.recurringRule.findMany({
      where: {
        direction: TransactionDirection.inflow,
        account: { userId },
        ...(accountId ? { accountId } : {})
      },
      select: { description: true }
    });
    const recurringDescriptions = new Set(
      recurringRules.map((rule) => this.normalizeDescription(rule.description))
    );
    const groups = new Map<string, { description: string; amounts: number[]; dates: Date[]; salary: boolean }>();

    for (const transaction of transactions) {
      if (
        transaction.account.kind === AccountKind.credit_card ||
        !isFaturamentoInflow(transaction)
      ) {
        continue;
      }
      const key = this.normalizeDescription(transaction.description);
      const group = groups.get(key) ?? {
        description: transaction.description,
        amounts: [],
        dates: [],
        salary: false
      };
      group.amounts.push(toNumber(transaction.amount));
      group.dates.push(transaction.transactionDate);
      group.salary = group.salary || isSalaryInflow(transaction);
      groups.set(key, group);
    }

    const occupiedDates = new Set(
      existingEvents
        .filter((event) => event.direction === TransactionDirection.inflow)
        .map((event) => `${event.date}:${this.normalizeDescription(event.description)}`)
    );
    const forecast: ProjectionEvent[] = [];

    for (const [descriptionKey, group] of groups) {
      const months = new Set(group.dates.map((date) => `${date.getUTCFullYear()}-${date.getUTCMonth()}`));
      if (!group.salary && months.size < 2) continue;
      if (recurringDescriptions.has(descriptionKey)) continue;

      const amount = group.amounts.reduce((sum, value) => sum + value, 0) / group.amounts.length;
      const day = Math.min(
        Math.round(group.dates.reduce((sum, date) => sum + date.getUTCDate(), 0) / group.dates.length),
        28
      );
      const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

      while (cursor <= horizonEnd) {
        const lastDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
        const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(day, lastDay)));
        const dateKey = toDateOnlyString(date);
        const eventKey = `${dateKey}:${descriptionKey}`;
        if (date >= startDate && date <= horizonEnd && !occupiedDates.has(eventKey)) {
          forecast.push({
            date: dateKey,
            amount,
            direction: TransactionDirection.inflow,
            description: group.description
          });
          occupiedDates.add(eventKey);
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }

    return forecast;
  }

  private async getConfiguredMonthlyIncome(userId: string) {
    const settings = await this.prisma.appSetting.findUnique({
      where: { userId },
      select: { monthlyIncome: true }
    });
    return settings?.monthlyIncome == null ? undefined : toNumber(settings.monthlyIncome);
  }

  private buildMonthlyIncomeForecast(
    startDate: Date,
    horizonEnd: Date,
    monthlyIncome: number,
    existingEvents: ProjectionEvent[]
  ) {
    if (monthlyIncome <= 0) return [];
    const occupiedDates = new Set(
      existingEvents
        .filter((event) => event.direction === TransactionDirection.inflow)
        .map((event) => event.date)
    );
    const forecast: ProjectionEvent[] = [];
    const cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

    while (cursor <= horizonEnd) {
      const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
      const dateKey = toDateOnlyString(date);
      if (date >= startDate && date <= horizonEnd && !occupiedDates.has(dateKey)) {
        forecast.push({
          date: dateKey,
          amount: monthlyIncome,
          direction: TransactionDirection.inflow,
          description: 'Renda mensal configurada'
        });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return forecast;
  }

  private normalizeDescription(value: string) {
    return value
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/^transferencia enviada\s*(?:\||[-:])?\s*/i, '')
      .replace(/^[a-z]{1,3}\*+/, '')
      .replace(/\byoutubepremium\b/g, 'youtube')
      .replace(/\byoutub\b/g, 'youtube')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sameRecurringDescription(left: string, right: string) {
    const leftTokens = this.normalizeDescription(this.cleanRecurringDescription(left)).split(' ').filter(Boolean);
    const rightTokens = this.normalizeDescription(this.cleanRecurringDescription(right)).split(' ').filter(Boolean);
    if (leftTokens.join(' ') === rightTokens.join(' ')) return true;
    const sharedTokens = leftTokens.filter((leftToken) =>
      rightTokens.some((rightToken) => leftToken.startsWith(rightToken) || rightToken.startsWith(leftToken))
    );
    return sharedTokens.length >= 2 && sharedTokens.length >= Math.min(leftTokens.length, rightTokens.length);
  }

  private cleanRecurringDescription(value: string) {
    const cleaned = value
      .replace(/^\s*transfer[eê]ncia enviada\s*(?:\||[-:])?\s*/i, '')
      .trim();
    return cleaned || value.trim();
  }

  private isCardInvoice(
    description: string,
    notes: string | null,
    accountKind: AccountKind,
    category?: { name: string } | null
  ) {
    const text = this.normalizeDescription(`${description} ${notes ?? ''}`);
    if (isPagamentoFaturaOutflow({ direction: TransactionDirection.outflow, description, notes, category })) return true;
    if (accountKind === AccountKind.credit_card) {
      return /pagamento.*(?:fatura|cartao)|fatura.*pagamento|payment.*(?:card|credit)/.test(text);
    }
    return /pagamento.*(?:fatura|cartao)|fatura.*pagamento|payment.*(?:card|credit)/.test(text);
  }

  private isTechnicalRecurringCandidate(description: string) {
    return /^(iof\b|saldo adicionado|limite convertido|parcela paga)/.test(this.normalizeDescription(description));
  }

  private async collectEvents(userId: string, startDate: Date, horizonEnd: Date, accountId?: string): Promise<ProjectionEvent[]> {
    const events: ProjectionEvent[] = [];

    const futureTransactions = await this.prisma.transaction.findMany({
      where: {
        account: { userId },
        ...(accountId ? { accountId } : {}),
        OR: [
          { postedDate: { gte: startDate, lte: horizonEnd } },
          { dueDate: { gte: startDate, lte: horizonEnd } }
        ]
      }
    });
    const actualMonthlyKeys = new Set(
      futureTransactions.map(
        (transaction) =>
          `${transaction.accountId}:${toDateOnlyString(transaction.transactionDate).slice(0, 7)}:${transaction.direction}:${this.normalizeDescription(this.cleanRecurringDescription(transaction.description))}`
      )
    );

    for (const tx of futureTransactions) {
      const date = tx.postedDate ?? tx.dueDate ?? tx.transactionDate;
      events.push({
        date: toDateOnlyString(date),
        amount: toNumber(tx.amount),
        direction: tx.direction,
        description: tx.description
      });
    }

    const rules = await this.prisma.recurringRule.findMany({
      where: accountId ? { accountId, account: { userId } } : { account: { userId } }
    });

    for (const rule of rules) {
      const dates = expandRecurringDates(
        rule.startDate,
        rule.endDate,
        rule.frequency,
        rule.dayOfMonth,
        horizonEnd
      );
      for (const date of dates) {
        if (date >= startDate) {
          const dateKey = toDateOnlyString(date);
          const actualMonthlyKey = `${rule.accountId}:${dateKey.slice(0, 7)}:${rule.direction}:${this.normalizeDescription(this.cleanRecurringDescription(rule.description))}`;
          const hasActualMonthlyMatch =
            rule.frequency === 'monthly' &&
            futureTransactions.some(
              (transaction) =>
                transaction.accountId === rule.accountId &&
                transaction.direction === rule.direction &&
                toDateOnlyString(transaction.transactionDate).slice(0, 7) === dateKey.slice(0, 7) &&
                this.sameRecurringDescription(transaction.description, rule.description)
            );
          if (actualMonthlyKeys.has(actualMonthlyKey) || hasActualMonthlyMatch) continue;
          events.push({
            date: dateKey,
            amount: toNumber(rule.amount),
            direction: rule.direction,
            description: rule.description
          });
        }
      }
    }

    const unpaidStatements = await this.prisma.creditCardStatement.findMany({
      where: {
        isPaid: false,
        dueDate: { gte: startDate, lte: horizonEnd },
        account: { userId },
        ...(accountId ? { accountId } : {})
      }
    });

    for (const statement of unpaidStatements) {
      events.push({
        date: toDateOnlyString(statement.dueDate),
        amount: toNumber(statement.totalAmount) - toNumber(statement.paidAmount),
        direction: TransactionDirection.outflow,
        description: 'Vencimento fatura cartão'
      });
    }

    return events;
  }
}
