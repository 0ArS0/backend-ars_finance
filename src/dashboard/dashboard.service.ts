import { Injectable } from '@nestjs/common';
import { AccountKind, BudgetType, PaymentMethod, Prisma, TransactionDirection } from '@prisma/client';
import { expandRecurringDates, MONTH_LABELS, periodRangeUTC, toDateOnlyString } from '../common/utils/date.util';
import { toNumber } from '../common/utils/decimal.util';
import {
  isAplicacaoOutflow,
  isDespesaOutflow,
  isFaturamentoInflow,
  isPagamentoFaturaOutflow,
  isReimbursementInflow,
  isResgateInflow,
  isSaidaOutflow,
  isSelfTransferOutflow
} from '../common/utils/inflow-classification.util';
import { PeriodQueryDto } from '../common/dto/period-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { buildTransactionWhere } from '../transactions/mappers/transaction.mapper';

type DashboardTransaction = Prisma.TransactionGetPayload<{
  include: {
    category: { select: { budgetType: true; name: true } };
    beneficiary: { select: { name: true } };
    account: { select: { kind: true } };
  };
}>;

type ProjectedDashboardTransaction = {
  id: string;
  accountId: string;
  direction: TransactionDirection;
  paymentMethod: PaymentMethod;
  amount: number;
  description: string;
  notes: null;
  transactionDate: string;
  incomeKind: null;
  account: { id: string; name: string; legalContext: string; kind: AccountKind };
  budgetType: BudgetType | null;
  category: { id: string; name: string; budgetType: BudgetType | null } | null;
  beneficiary: { id: string; name: string } | null;
  source: 'recurring' | 'monthly_income';
};

function getMovementBudgetType(item: DashboardTransaction | ProjectedDashboardTransaction) {
  if ('budgetType' in item && item.budgetType) return item.budgetType;
  return item.category?.budgetType ?? null;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(query: PeriodQueryDto, userId: string) {
    const filtered = await this.prisma.transaction.findMany({
      where: buildTransactionWhere({ ...query, userId }),
      include: {
        category: { select: { budgetType: true, name: true } },
        beneficiary: { select: { name: true } },
        account: { select: { kind: true } }
      }
    });
    const projectedTransactions = await this.getProjectedTransactions({ ...query, userId }, filtered);
    const periodMovements = [...filtered, ...projectedTransactions];

    const faturamento = periodMovements
      .filter((item) => isFaturamentoInflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const reembolsos = periodMovements
      .filter((item) => isReimbursementInflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const resgates = periodMovements
      .filter((item) => isResgateInflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const receitas = faturamento + reembolsos + resgates;
    const aplicacoes = periodMovements
      .filter((item) => isAplicacaoOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const pagamentosFatura = periodMovements
      .filter((item) => isPagamentoFaturaOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const transferenciasProprias = periodMovements
      .filter((item) => isSelfTransferOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const despesas = periodMovements
      .filter((item) => isDespesaOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const saidas = periodMovements
      .filter((item) => isSaidaOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const fixo = periodMovements
      .filter((item) => isDespesaOutflow(item) && getMovementBudgetType(item) === BudgetType.fixed)
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const variavel = periodMovements
      .filter((item) => isDespesaOutflow(item) && getMovementBudgetType(item) === BudgetType.variable)
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const despesasCartao = periodMovements
      .filter((item) => item.account.kind === AccountKind.credit_card && isDespesaOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const despesasOutras = periodMovements
      .filter((item) => item.account.kind !== AccountKind.credit_card && isDespesaOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);

    const yearWhere = buildTransactionWhere({
      ...query,
      userId,
      view: 'annual',
      month: 1,
      startMonth: query.view === 'annual' ? query.startMonth : 1,
      endMonth: query.view === 'annual' ? query.endMonth : 12
    });

    const yearTransactions = await this.prisma.transaction.findMany({
      where: yearWhere,
      include: {
        category: { select: { budgetType: true, name: true } },
        beneficiary: { select: { name: true } },
        account: { select: { kind: true } }
      }
    });
    const projectedYearTransactions =
      query.view === 'annual'
        ? projectedTransactions
        : await this.getProjectedTransactions({ ...query, view: 'annual', userId }, yearTransactions);

    const chartStartMonth = query.view === 'annual' ? query.startMonth : 1;
    const chartEndMonth = query.view === 'annual' ? query.endMonth : 12;
    const monthlySeries = Array.from({ length: chartEndMonth - chartStartMonth + 1 }, (_, index) => {
      const monthIndex = chartStartMonth + index;
      const actualMonthTransactions = yearTransactions.filter((item) => {
        const date = new Date(item.transactionDate);
        return date.getUTCFullYear() === query.year && date.getUTCMonth() + 1 === monthIndex;
      });
      const projectedMonthTransactions = projectedYearTransactions.filter((item) => {
        const date = new Date(item.transactionDate);
        return date.getUTCFullYear() === query.year && date.getUTCMonth() + 1 === monthIndex;
      });
      const monthTransactions = [...actualMonthTransactions, ...projectedMonthTransactions];

      const monthDespesas = monthTransactions
        .filter((item) => isDespesaOutflow(item))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthAplicacoes = monthTransactions
        .filter((item) => isAplicacaoOutflow(item))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthResgates = monthTransactions
        .filter((item) => isResgateInflow(item))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthSaidas = monthTransactions
        .filter((item) => isSaidaOutflow(item))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthDespesasCartao = monthTransactions
        .filter((item) => item.account.kind === AccountKind.credit_card && isDespesaOutflow(item))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthDespesasOutras = monthTransactions
        .filter((item) => item.account.kind !== AccountKind.credit_card && isDespesaOutflow(item))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthFixo = monthTransactions
        .filter((item) => isDespesaOutflow(item) && getMovementBudgetType(item) === BudgetType.fixed)
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthVariavel = monthTransactions
        .filter((item) => isDespesaOutflow(item) && getMovementBudgetType(item) === BudgetType.variable)
        .reduce((sum, item) => sum + toNumber(item.amount), 0);

      return {
        month: MONTH_LABELS[monthIndex - 1],
        faturamento: monthTransactions
          .filter((item) => isFaturamentoInflow(item))
          .reduce((sum, item) => sum + toNumber(item.amount), 0),
        reembolsos: monthTransactions
          .filter((item) => isReimbursementInflow(item))
          .reduce((sum, item) => sum + toNumber(item.amount), 0),
        resgates: monthTransactions
          .filter((item) => isResgateInflow(item))
          .reduce((sum, item) => sum + toNumber(item.amount), 0),
        aplicacoes: monthAplicacoes - monthResgates,
        receitas: monthTransactions
          .filter((item) => item.direction === TransactionDirection.inflow)
          .reduce((sum, item) => sum + toNumber(item.amount), 0),
        despesas: monthDespesas,
        despesasCartao: monthDespesasCartao,
        despesasOutras: monthDespesasOutras,
        fixo: monthFixo,
        variavel: monthVariavel,
        saidas: monthSaidas
      };
    });

    const beneficiaryTotals = new Map<
      string,
      {
        faturamento: number;
        reembolsos: number;
        resgates: number;
        aplicacoes: number;
        receitas: number;
        despesas: number;
        despesasCartao: number;
        despesasOutras: number;
        fixo: number;
        variavel: number;
        saidas: number;
      }
    >();

    for (const item of periodMovements) {
      const name = item.beneficiary?.name ?? 'Sem titular';
      const entry = beneficiaryTotals.get(name) ?? {
        faturamento: 0,
        reembolsos: 0,
        resgates: 0,
        aplicacoes: 0,
        receitas: 0,
        despesas: 0,
        despesasCartao: 0,
        despesasOutras: 0,
        fixo: 0,
        variavel: 0,
        saidas: 0
      };
      const amount = toNumber(item.amount);

      if (item.direction === TransactionDirection.inflow) {
        entry.receitas += amount;
        if (isReimbursementInflow(item)) entry.reembolsos += amount;
        else if (isResgateInflow(item)) {
          entry.resgates += amount;
          entry.aplicacoes -= amount;
        }
        else if (isFaturamentoInflow(item)) entry.faturamento += amount;
      } else if (isAplicacaoOutflow(item)) {
        entry.aplicacoes += amount;
        entry.saidas += amount;
      } else if (isDespesaOutflow(item)) {
        entry.despesas += amount;
        if (item.account?.kind === AccountKind.credit_card) entry.despesasCartao += amount;
        else entry.despesasOutras += amount;
        if (getMovementBudgetType(item) === BudgetType.fixed) entry.fixo += amount;
        if (getMovementBudgetType(item) === BudgetType.variable) entry.variavel += amount;
        entry.saidas += amount;
      } else if (item.direction === TransactionDirection.outflow) {
        entry.saidas += amount;
      }

      beneficiaryTotals.set(name, entry);
    }

    const beneficiarySeries = Array.from(beneficiaryTotals.entries())
      .map(([name, totals]) => ({ name, ...totals }))
      .sort((a, b) => b.receitas + b.saidas - (a.receitas + a.saidas));

    const accounts = await this.prisma.financialAccount.findMany({
      where: {
        isActive: true,
        kind: { not: AccountKind.credit_card },
        userId,
        ...(query.accountId
          ? { id: query.accountId }
          : query.legalContext
            ? { legalContext: query.legalContext }
            : query.accountScope !== 'all'
              ? { legalContext: query.accountScope }
              : {})
      }
    });

    const accountIds = accounts.map((account) => account.id);
    const fullPeriodTransactions = await this.prisma.transaction.findMany({
      where: { accountId: { in: accountIds } },
      include: { category: { select: { budgetType: true, name: true } } }
    });
    const aplicacoesTotais = fullPeriodTransactions
      .filter((item) => isAplicacaoOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const resgatesTotais = fullPeriodTransactions
      .filter((item) => isResgateInflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const aplicacoesProjetadas = projectedTransactions
      .filter((item) => isAplicacaoOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const resgatesProjetados = projectedTransactions
      .filter((item) => isResgateInflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const guardados = Math.max(
      0,
      aplicacoesTotais + aplicacoesProjetadas - resgatesTotais - resgatesProjetados
    );
    const { saldoInicial, saldo, saldoPeriodo, saldoAtual } = await this.resolveBalanceSummary(
      { ...query, userId },
      accountIds,
      projectedTransactions
    );

    return {
      summary: {
        receitas,
        faturamento,
        reembolsos,
        resgates,
        aplicacoes: guardados,
        pagamentosFatura,
        transferenciasProprias,
        despesas,
        despesasCartao,
        despesasOutras,
        saidas,
        saldoInicial,
        saldo,
        saldoPeriodo,
        saldoAtual,
        fixo,
        variavel
      },
      monthlySeries,
      beneficiarySeries,
      projectedTransactions
    };
  }

  private async getProjectedTransactions(
    query: PeriodQueryDto & { userId: string },
    actualTransactions: DashboardTransaction[]
  ): Promise<ProjectedDashboardTransaction[]> {
    const range = periodRangeUTC(query.year, query.month, query.view);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const accountWhere = query.accountId
      ? { id: query.accountId }
      : query.accountScope !== 'all'
        ? { legalContext: query.accountScope }
        : {};
    const accounts = await this.prisma.financialAccount.findMany({
      where: { ...accountWhere, isActive: true, userId: query.userId },
      select: { id: true, name: true, legalContext: true, kind: true }
    });
    const accountIds = accounts.map((account) => account.id);
    if (accountIds.length === 0) return [];

    const rules = await this.prisma.recurringRule.findMany({
      where: { accountId: { in: accountIds } },
      include: {
        account: { select: { id: true, name: true, legalContext: true, kind: true } },
        category: { select: { id: true, name: true, budgetType: true } },
        beneficiary: { select: { id: true, name: true } }
      }
    });
    const actualKeys = new Set(
      actualTransactions.map(
        (transaction) =>
          `${transaction.accountId}:${toDateOnlyString(transaction.transactionDate)}:${transaction.direction}:${this.normalizeDescription(transaction.description)}`
      )
    );
    const actualMonthlyKeys = new Set(
      actualTransactions.map(
        (transaction) =>
          `${transaction.accountId}:${toDateOnlyString(transaction.transactionDate).slice(0, 7)}:${transaction.direction}:${this.normalizeDescription(transaction.description)}`
      )
    );
    const projected = [];

    for (const rule of rules) {
      const dates = expandRecurringDates(
        rule.startDate,
        rule.endDate,
        rule.frequency,
        rule.dayOfMonth,
        range.lte
      );
      for (const date of dates) {
        const isCurrentMonth =
          date.getUTCFullYear() === today.getUTCFullYear() &&
          date.getUTCMonth() === today.getUTCMonth();
        if (date < range.gte || date > range.lte || (!isCurrentMonth && date < today)) continue;
        const dateKey = toDateOnlyString(date);
        const actualKey = `${rule.accountId}:${dateKey}:${rule.direction}:${this.normalizeDescription(rule.description)}`;
        const actualMonthlyKey = `${rule.accountId}:${dateKey.slice(0, 7)}:${rule.direction}:${this.normalizeDescription(rule.description)}`;
        const hasActualMonthlyMatch =
          rule.frequency === 'monthly' &&
          actualTransactions.some(
            (transaction) =>
              transaction.accountId === rule.accountId &&
              transaction.direction === rule.direction &&
              toDateOnlyString(transaction.transactionDate).slice(0, 7) === dateKey.slice(0, 7) &&
              this.sameRecurringDescription(transaction.description, rule.description)
          );
        if (actualKeys.has(actualKey) || actualMonthlyKeys.has(actualMonthlyKey) || hasActualMonthlyMatch) continue;
        projected.push({
          id: `projected:${rule.id}:${dateKey}`,
          accountId: rule.accountId,
          direction: rule.direction,
          amount: toNumber(rule.amount),
          description: rule.description,
          transactionDate: dateKey,
          paymentMethod: PaymentMethod.transfer,
          notes: null,
          incomeKind: null,
          account: rule.account,
          budgetType: rule.budgetType,
          category: rule.category,
          beneficiary: rule.beneficiary,
          source: 'recurring' as const
        });
      }
    }

    const settings = await this.prisma.appSetting.findUnique({
      where: { userId: query.userId },
      select: { monthlyIncome: true }
    });
    const monthlyIncome = settings?.monthlyIncome == null ? 0 : toNumber(settings.monthlyIncome);
    const incomeAccount = accounts.find((account) => account.kind !== AccountKind.credit_card);
    if (monthlyIncome > 0 && incomeAccount) {
      const occupiedIncomeMonths = new Set(
        actualTransactions
          .filter(
            (transaction) =>
              transaction.accountId === incomeAccount.id &&
              transaction.direction === TransactionDirection.inflow &&
              isFaturamentoInflow(transaction)
          )
          .map((transaction) => toDateOnlyString(transaction.transactionDate).slice(0, 7))
      );
      const cursor = new Date(Date.UTC(range.gte.getUTCFullYear(), range.gte.getUTCMonth(), 1));
      while (cursor <= range.lte) {
        const dateKey = toDateOnlyString(cursor);
        const isCurrentMonth =
          cursor.getUTCFullYear() === today.getUTCFullYear() &&
          cursor.getUTCMonth() === today.getUTCMonth();
        if (
          cursor >= range.gte &&
          cursor <= range.lte &&
          (cursor >= today || isCurrentMonth) &&
          !occupiedIncomeMonths.has(dateKey.slice(0, 7))
        ) {
          projected.push({
            id: `projected:monthly-income:${dateKey}`,
            accountId: incomeAccount.id,
            direction: TransactionDirection.inflow,
            paymentMethod: PaymentMethod.transfer,
            amount: monthlyIncome,
            description: 'Renda mensal configurada',
            transactionDate: dateKey,
            notes: null,
            incomeKind: null,
            account: incomeAccount,
            budgetType: null,
            category: null,
            beneficiary: null,
            source: 'monthly_income' as const
          });
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }

    return projected.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
  }

  private normalizeDescription(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/^transferencia enviada\s*(?:\||[-:])?\s*/i, '')
      .replace(/^[a-z]{1,3}\*+/, '')
      .replace(/\byoutubepremium\b/g, 'youtube')
      .replace(/\byoutub\b/g, 'youtube')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sameRecurringDescription(left: string, right: string) {
    const leftTokens = this.normalizeDescription(left).split(' ').filter(Boolean);
    const rightTokens = this.normalizeDescription(right).split(' ').filter(Boolean);
    if (leftTokens.join(' ') === rightTokens.join(' ')) return true;
    const sharedTokens = leftTokens.filter((leftToken) =>
      rightTokens.some((rightToken) => leftToken.startsWith(rightToken) || rightToken.startsWith(leftToken))
    );
    return sharedTokens.length >= 2 && sharedTokens.length >= Math.min(leftTokens.length, rightTokens.length);
  }

  private async resolveBalanceSummary(
    query: PeriodQueryDto & { userId: string },
    accountIds: string[],
    projectedTransactions: ProjectedDashboardTransaction[]
  ): Promise<{ saldoInicial: number; saldo: number; saldoPeriodo: number; saldoAtual: number }> {
    const empty = { saldoInicial: 0, saldo: 0, saldoPeriodo: 0, saldoAtual: 0 };
    if (accountIds.length === 0) return empty;

    const accounts = await this.prisma.financialAccount.findMany({
      where: { id: { in: accountIds }, userId: query.userId },
      select: { id: true, openingBalance: true, currentBalance: true }
    });
    const transactions = await this.prisma.transaction.findMany({
      where: { accountId: { in: accountIds } },
      select: { accountId: true, direction: true, amount: true, transactionDate: true }
    });
    const now = new Date();

    const balanceAt = (date: Date) =>
      accounts.reduce((sum, account) => {
        const accountTransactions = transactions.filter(
          (transaction) =>
            transaction.accountId === account.id &&
            transaction.transactionDate < date
        );
        const movement = accountTransactions.reduce(
          (total, transaction) =>
            total +
            (transaction.direction === TransactionDirection.inflow
              ? toNumber(transaction.amount)
              : -toNumber(transaction.amount)),
          0
        );
        if (account.currentBalance == null) {
          return sum + toNumber(account.openingBalance) + movement;
        }

        const movementsAfterDate = transactions
          .filter(
            (transaction) =>
              transaction.accountId === account.id &&
              transaction.transactionDate >= date &&
              transaction.transactionDate <= now
          )
          .reduce(
            (total, transaction) =>
              total +
              (transaction.direction === TransactionDirection.inflow
                ? toNumber(transaction.amount)
                : -toNumber(transaction.amount)),
            0
          );
        return sum + toNumber(account.currentBalance) - movementsAfterDate;
      }, 0);

    const saldoAtual = accounts.reduce(
      (sum, account) => sum + (account.currentBalance == null ? 0 : toNumber(account.currentBalance)),
      0
    ) + accounts
      .filter((account) => account.currentBalance == null)
      .reduce((sum, account) => {
        const movement = transactions
          .filter(
            (transaction) =>
              transaction.accountId === account.id &&
              transaction.transactionDate <= now
          )
          .reduce(
            (total, transaction) =>
              total +
              (transaction.direction === TransactionDirection.inflow
                ? toNumber(transaction.amount)
                : -toNumber(transaction.amount)),
            0
          );
        return sum + toNumber(account.openingBalance) + movement;
      }, 0);

    const periodStart =
      query.view === 'monthly'
        ? periodRangeUTC(query.year, query.month, 'monthly').gte
        : periodRangeUTC(query.year, query.month, 'annual', query.startMonth, query.endMonth).gte;
    const periodEnd =
      query.view === 'monthly'
        ? new Date(Date.UTC(query.year, query.month, 1))
        : new Date(Date.UTC(query.year, query.endMonth, 1));
    const saldoInicial = balanceAt(periodStart);
    const saldo = balanceAt(periodEnd);
    const saldoPeriodo = transactions
      .filter(
        (transaction) =>
          transaction.transactionDate >= periodStart &&
          transaction.transactionDate < periodEnd
      )
      .reduce(
        (total, transaction) =>
          total +
          (transaction.direction === TransactionDirection.inflow
            ? toNumber(transaction.amount)
            : -toNumber(transaction.amount)),
        0
      );
    const projectedPeriodMovement = projectedTransactions
      .filter((transaction) => {
        const date = new Date(`${transaction.transactionDate}T00:00:00Z`);
        return date >= periodStart && date < periodEnd;
      })
      .reduce(
        (total, transaction) =>
          total + (transaction.direction === TransactionDirection.inflow ? transaction.amount : -transaction.amount),
        0
      );

    return {
      saldoInicial,
      saldoPeriodo: saldoPeriodo + projectedPeriodMovement,
      saldo: saldo + projectedPeriodMovement,
      saldoAtual
    };
  }
}
