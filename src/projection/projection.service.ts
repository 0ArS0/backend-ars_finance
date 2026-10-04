import { Injectable } from '@nestjs/common';
import { AccountKind, AppSetting, TransactionDirection } from '@prisma/client';
import { addDays, expandRecurringDates, toDateOnlyString } from '../common/utils/date.util';
import { toNumber } from '../common/utils/decimal.util';
import { buildProjection, ProjectionEvent, safeToSpend } from '../common/utils/finance.util';
import {
  isDespesaOutflow,
  isFaturamentoInflow,
  isPagamentoFaturaOutflow,
  isReimbursementInflow,
  isSalaryInflow
} from '../common/utils/inflow-classification.util';
import { loadClassificationContext } from '../common/classification/load-classification-context';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectionQueryDto, SafeToSpendQueryDto, UpdateProjectionSettingsDto } from './dto/projection.dto';

type SuggestionTransaction = {
  id: string;
  description: string;
  notes: string | null;
  amount: number;
  direction: TransactionDirection;
  paymentMethod: string;
  transactionDate: string;
  postedDate: string | null;
  dueDate: string | null;
  incomeKind: string | null;
  externalId: string | null;
  statementId: string | null;
  installmentN: number | null;
  installmentTotal: number | null;
  accountName: string;
  accountKind: string;
  legalContext: string | null;
  categoryName: string | null;
  payeeName: string | null;
  beneficiaryName: string | null;
};

type SuggestionGroup = {
  accountId: string;
  accountName: string;
  description: string;
  categoryIds: string[];
  transactions: SuggestionTransaction[];
};

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

  private mapSettings(settings: AppSetting | null) {
    return {
      monthlyIncome: settings?.monthlyIncome == null ? null : toNumber(settings.monthlyIncome),
      budgetInvestmentsPct: settings?.budgetInvestmentsPct == null ? null : toNumber(settings.budgetInvestmentsPct),
      budgetExpensesPct: settings?.budgetExpensesPct == null ? null : toNumber(settings.budgetExpensesPct),
      budgetRecreationPct: settings?.budgetRecreationPct == null ? null : toNumber(settings.budgetRecreationPct),
      budgetGoalsPct: settings?.budgetGoalsPct == null ? null : toNumber(settings.budgetGoalsPct),
      budgetCardPct: settings?.budgetCardPct == null ? null : toNumber(settings.budgetCardPct)
    };
  }

  async getSettings(userId: string) {
    const settings = await this.prisma.appSetting.findUnique({ where: { userId } });
    return this.mapSettings(settings);
  }

  async updateSettings(userId: string, dto: UpdateProjectionSettingsDto) {
    const data: {
      monthlyIncome?: number | null;
      budgetInvestmentsPct?: number | null;
      budgetExpensesPct?: number | null;
      budgetRecreationPct?: number | null;
      budgetGoalsPct?: number | null;
      budgetCardPct?: number | null;
    } = {};
    if (dto.monthlyIncome !== undefined) data.monthlyIncome = dto.monthlyIncome;
    if (dto.budgetInvestmentsPct !== undefined) data.budgetInvestmentsPct = dto.budgetInvestmentsPct;
    if (dto.budgetExpensesPct !== undefined) data.budgetExpensesPct = dto.budgetExpensesPct;
    if (dto.budgetRecreationPct !== undefined) data.budgetRecreationPct = dto.budgetRecreationPct;
    if (dto.budgetGoalsPct !== undefined) data.budgetGoalsPct = dto.budgetGoalsPct;
    if (dto.budgetCardPct !== undefined) data.budgetCardPct = dto.budgetCardPct;

    const settings = await this.prisma.appSetting.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data
    });
    return this.mapSettings(settings);
  }

  async getRecurringSuggestions(userId: string, accountId?: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const ctx = await loadClassificationContext(this.prisma, userId);
    const threeMonthsAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));
    const previousMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const currentMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const include = {
      account: { select: { name: true, kind: true, legalContext: true } },
      category: { select: { id: true, name: true, budgetType: true } },
      payee: { select: { name: true } },
      beneficiary: { select: { name: true } }
    } as const;
    const [outflows, inflows, existingRules] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          direction: TransactionDirection.outflow,
          account: { userId },
          ...(accountId ? { accountId } : {})
        },
        include,
        orderBy: { transactionDate: 'asc' }
      }),
      this.prisma.transaction.findMany({
        where: {
          direction: TransactionDirection.inflow,
          account: { userId },
          ...(accountId ? { accountId } : {})
        },
        include,
        orderBy: { transactionDate: 'asc' }
      }),
      this.prisma.recurringRule.findMany({
        where: { account: { userId } },
        select: { accountId: true, description: true }
      })
    ]);
    const existingKeys = new Set(
      existingRules.map(
        (rule) => `${rule.accountId}:${this.normalizeDescription(this.cleanRecurringDescription(rule.description))}`
      )
    );
    const expenseGroups = new Map<string, SuggestionGroup>();
    for (const transaction of outflows) {
      if (
        !isDespesaOutflow(transaction, ctx) ||
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
      this.pushSuggestionGroup(expenseGroups, existingKeys, transaction);
    }
    const reimbursementGroups = new Map<string, SuggestionGroup>();
    for (const transaction of inflows) {
      if (!isReimbursementInflow(transaction, ctx) || transaction.account.kind === AccountKind.credit_card) continue;
      this.pushSuggestionGroup(reimbursementGroups, existingKeys, transaction);
    }

    const expenses = Array.from(expenseGroups.entries())
      .filter(([, group]) => {
        const months = new Set(group.transactions.map((item) => item.transactionDate.slice(0, 7)));
        const recentDates = group.transactions.filter((item) => item.transactionDate >= toDateOnlyString(threeMonthsAgo));
        const hasPreviousMonthOccurrence = group.transactions.some((item) => {
          const date = item.transactionDate;
          return date >= toDateOnlyString(previousMonth) && date < toDateOnlyString(currentMonth);
        });
        return (
          group.transactions.length >= 2 &&
          recentDates.length >= 2 &&
          months.size >= 2 &&
          group.transactions.length <= months.size * 2 &&
          hasPreviousMonthOccurrence
        );
      })
      .map(([id, group]) => this.toSuggestion(id, group, 'outflow', 'expense'))
      .sort((left, right) => right.occurrences - left.occurrences)
      .slice(0, 20);

    const reimbursements = Array.from(reimbursementGroups.entries())
      .filter(([, group]) => {
        const months = new Set(group.transactions.map((item) => item.transactionDate.slice(0, 7)));
        const recentDates = group.transactions.filter((item) => item.transactionDate >= toDateOnlyString(threeMonthsAgo));
        return group.transactions.length >= 2 && recentDates.length >= 1 && months.size >= 2;
      })
      .map(([id, group]) => this.toSuggestion(id, group, 'inflow', 'reimbursement'))
      .sort((left, right) => right.occurrences - left.occurrences)
      .slice(0, 12);

    const items = [...expenses, ...reimbursements].sort((left, right) => {
      if (right.occurrences !== left.occurrences) return right.occurrences - left.occurrences;
      return right.lastDate.localeCompare(left.lastDate);
    });

    return { items, expenses, reimbursements };
  }

  private pushSuggestionGroup(
    groups: Map<string, SuggestionGroup>,
    existingKeys: Set<string>,
    transaction: {
      id: string;
      accountId: string;
      description: string;
      notes: string | null;
      amount: Parameters<typeof toNumber>[0];
      direction: TransactionDirection;
      paymentMethod: string;
      transactionDate: Date;
      postedDate: Date | null;
      dueDate: Date | null;
      incomeKind: string | null;
      externalId: string | null;
      statementId: string | null;
      installmentN: number | null;
      installmentTotal: number | null;
      category?: { id: string; name: string } | null;
      payee?: { name: string } | null;
      beneficiary?: { name: string } | null;
      account: { name: string; kind: string; legalContext: string };
    }
  ) {
    const description = this.cleanRecurringDescription(transaction.description);
    const normalized = this.normalizeDescription(description);
    const key = `${transaction.accountId}:${normalized}`;
    if (existingKeys.has(key)) return;
    const group = groups.get(key) ?? {
      accountId: transaction.accountId,
      accountName: transaction.account.name,
      description,
      categoryIds: [],
      transactions: []
    };
    group.transactions.push({
      id: transaction.id,
      description: transaction.description,
      notes: transaction.notes,
      amount: toNumber(transaction.amount),
      direction: transaction.direction,
      paymentMethod: transaction.paymentMethod,
      transactionDate: toDateOnlyString(transaction.transactionDate),
      postedDate: transaction.postedDate ? toDateOnlyString(transaction.postedDate) : null,
      dueDate: transaction.dueDate ? toDateOnlyString(transaction.dueDate) : null,
      incomeKind: transaction.incomeKind,
      externalId: transaction.externalId,
      statementId: transaction.statementId,
      installmentN: transaction.installmentN,
      installmentTotal: transaction.installmentTotal,
      accountName: transaction.account.name,
      accountKind: transaction.account.kind,
      legalContext: transaction.account.legalContext,
      categoryName: transaction.category?.name ?? null,
      payeeName: transaction.payee?.name ?? null,
      beneficiaryName: transaction.beneficiary?.name ?? null
    });
    if (transaction.category?.id) group.categoryIds.push(transaction.category.id);
    groups.set(key, group);
  }

  private toSuggestion(
    id: string,
    group: SuggestionGroup,
    direction: 'inflow' | 'outflow',
    kind: 'expense' | 'reimbursement'
  ) {
    const dates = group.transactions.map((item) => item.transactionDate);
    const dayCounts = new Map<number, number>();
    for (const date of dates) {
      const day = Number(date.slice(8, 10));
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }
    const dayOfMonth = Array.from(dayCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 1;
    const categoryCounts = new Map<string, number>();
    for (const categoryId of group.categoryIds) {
      categoryCounts.set(categoryId, (categoryCounts.get(categoryId) ?? 0) + 1);
    }
    const categoryId = Array.from(categoryCounts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
    const last = group.transactions[group.transactions.length - 1];
    return {
      id,
      accountId: group.accountId,
      accountName: group.accountName,
      description: group.description,
      amount: Math.round((last?.amount ?? 0) * 100) / 100,
      frequency: 'monthly' as const,
      dayOfMonth,
      startDate: dates[0],
      lastDate: dates[dates.length - 1],
      occurrences: group.transactions.length,
      categoryId: categoryId ?? null,
      direction,
      kind,
      transactions: [...group.transactions].reverse()
    };
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

    const ctx = await loadClassificationContext(this.prisma, userId);
    const transactions = await this.prisma.transaction.findMany({
      where: {
        direction: TransactionDirection.inflow,
        transactionDate: { lt: startDate },
        account: { userId },
        ...(accountId ? { accountId } : {})
      },
      include: {
        account: { select: { kind: true } },
        category: { select: { name: true } },
        beneficiary: { select: { name: true } }
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
    const groups = new Map<
      string,
      { description: string; amounts: number[]; dates: Date[]; salary: boolean; reimbursement: boolean }
    >();

    for (const transaction of transactions) {
      if (
        transaction.account.kind === AccountKind.credit_card ||
        isReimbursementInflow(transaction, ctx) ||
        !isFaturamentoInflow(transaction, ctx)
      ) {
        continue;
      }
      const key = this.normalizeDescription(transaction.description);
      const group = groups.get(key) ?? {
        description: transaction.description,
        amounts: [],
        dates: [],
        salary: false,
        reimbursement: false
      };
      group.amounts.push(toNumber(transaction.amount));
      group.dates.push(transaction.transactionDate);
      group.salary = group.salary || isSalaryInflow(transaction, ctx);
      group.reimbursement = group.reimbursement || isReimbursementInflow(transaction, ctx);
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
      },
      include: {
        account: { select: { kind: true } },
        category: { select: { name: true } }
      }
    });
    const cashTransactions = futureTransactions.filter((transaction) => transaction.account.kind !== AccountKind.credit_card);
    const actualMonthlyKeys = new Set(
      cashTransactions.map(
        (transaction) =>
          `${transaction.accountId}:${toDateOnlyString(transaction.transactionDate).slice(0, 7)}:${transaction.direction}:${this.normalizeDescription(this.cleanRecurringDescription(transaction.description))}`
      )
    );

    for (const tx of cashTransactions) {
      const date = tx.postedDate ?? tx.dueDate ?? tx.transactionDate;
      events.push({
        date: toDateOnlyString(date),
        amount: toNumber(tx.amount),
        direction: tx.direction,
        description: tx.description
      });
    }

    const ctx = await loadClassificationContext(this.prisma, userId);
    const rules = await this.prisma.recurringRule.findMany({
      where: accountId ? { accountId, account: { userId } } : { account: { userId } },
      include: {
        account: { select: { kind: true, name: true } },
        category: { select: { name: true } },
        beneficiary: { select: { name: true } }
      }
    });

    for (const rule of rules) {
      if (rule.account.kind === AccountKind.credit_card) continue;
      if (
        rule.frequency !== 'once' &&
        isReimbursementInflow(
          {
            ...rule,
            payee: rule.beneficiary
          },
          ctx
        )
      ) {
        continue;
      }
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
            (rule.frequency === 'monthly' || rule.frequency === 'once') &&
            cashTransactions.some(
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

    const selectedAccount = accountId
      ? await this.prisma.financialAccount.findFirst({ where: { id: accountId, userId }, select: { kind: true } })
      : null;
    if (selectedAccount?.kind !== AccountKind.credit_card) {
      const unpaidStatements = await this.prisma.creditCardStatement.findMany({
        where: {
          isPaid: false,
          dueDate: { gte: startDate, lte: horizonEnd },
          account: { userId, kind: AccountKind.credit_card }
        }
      });

      for (const statement of unpaidStatements) {
        const dueDate = toDateOnlyString(statement.dueDate);
        const amount = toNumber(statement.totalAmount) - toNumber(statement.paidAmount);
        if (amount <= 0) continue;
        const alreadyPaid = cashTransactions.some(
          (transaction) =>
            transaction.direction === TransactionDirection.outflow &&
            this.isCardInvoice(
              transaction.description,
              transaction.notes,
              transaction.account.kind,
              transaction.category
            ) &&
            Math.abs(toNumber(transaction.amount) - amount) < 0.01
        );
        if (alreadyPaid) continue;
        events.push({
          date: dueDate,
          amount,
          direction: TransactionDirection.outflow,
          description: 'Vencimento fatura cartão'
        });
      }
    }

    return events;
  }
}
