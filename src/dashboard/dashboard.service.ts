import { Injectable } from '@nestjs/common';
import { AccountKind, BudgetType, IncomeKind, PaymentMethod, Prisma, TransactionDirection } from '@prisma/client';
import { loadClassificationContext } from '../common/classification/load-classification-context';
import { expandRecurringDates, MONTH_LABELS, addYearMonth, compareYearMonth, monthLabel, monthRangeUTC, periodRangeUTC, toDateOnlyString, YearMonth } from '../common/utils/date.util';
import { toNumber } from '../common/utils/decimal.util';
import {
  ClassificationContext,
  classifyMovement,
  expenseGroupLabel,
  isAplicacaoOutflow,
  isDespesaOutflow,
  isFaturamentoInflow,
  isPagamentoFaturaOutflow,
  isReimbursementInflow,
  isResgateInflow,
  isSaidaOutflow,
  isSalaryInflow,
  isSelfTransferOutflow
} from '../common/utils/inflow-classification.util';
import { PeriodQueryDto } from '../common/dto/period-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { buildTransactionWhere } from '../transactions/mappers/transaction.mapper';

type DashboardTransaction = Prisma.TransactionGetPayload<{
  include: {
    category: { select: { budgetType: true; name: true; kind: true } };
    beneficiary: { select: { name: true } };
    payee: { select: { name: true } };
    account: { select: { kind: true; name: true } };
    reimbursementExpenses: { select: { expenseId: true } };
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
  incomeKind: IncomeKind | null;
  account: { id: string; name: string; legalContext: string; kind: AccountKind };
  budgetType: BudgetType | null;
  category: { id: string; name: string; budgetType: BudgetType | null } | null;
  beneficiary: { id: string; name: string } | null;
  source: 'recurring' | 'monthly_income' | 'installment' | 'card_estimate' | 'card_open' | 'reimbursement_forecast';
};

function ratio(part: number, total: number) {
  if (total <= 0) return 0;
  return part / total;
}

function displayAccountLabel(kind: AccountKind | undefined, name?: string | null) {
  const shortened = (name ?? '')
    .replace(/\bNu Pagamentos S\.?A\.?\b/gi, 'Nubank')
    .replace(/\s*[-–]\s*Institui[cç][aã]o de Pagamento.*$/i, '')
    .replace(/\s*\((?:Conta )?Pr[eé]-paga\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (kind === AccountKind.credit_card) {
    if (!shortened) return 'Cartão de crédito';
    if (/^gold$/i.test(shortened)) return 'Cartão Gold';
    if (!/^cart[aã]o\b/i.test(shortened)) return `Cartão ${shortened}`;
    return shortened;
  }

  return shortened || 'Outras contas';
}

function reimbursementGroupLabel(item: {
  description?: string | null;
  beneficiary?: { name?: string | null } | null;
  payee?: { name?: string | null } | null;
  account?: { name?: string | null } | null;
}) {
  const who = item.beneficiary?.name?.trim() || item.payee?.name?.trim() || '';
  const what = (item.description ?? '').replace(/^Transfer[eê]ncia\s+(?:Recebida|Enviada)\s*/i, '').trim();
  if (who && what && !what.toLocaleLowerCase().includes(who.toLocaleLowerCase())) return `${who} · ${what}`;
  return who || what || item.account?.name?.trim() || 'Reembolso';
}

type ShareMovement = {
  id: string;
  kind: 'actual' | 'projected';
  description: string;
  amount: number;
  transactionDate: string;
  direction: 'inflow' | 'outflow';
  accountName: string;
  categoryName: string | null;
  partyName: string | null;
  incomeKind: string | null;
  role: string;
};

function partyFromDescription(description?: string | null) {
  if (!description) return null;
  let text = description;
  for (let i = 0; i < 3; i += 1) {
    const next = text
      .replace(/^Transfer[eê]ncia\s+(?:Recebida|Enviada)\s*/i, '')
      .replace(/^pelo\s+pix\s*/i, '')
      .replace(/^pix\s*/i, '')
      .replace(/^\s*[|:;·•\-–—]+\s*/u, '')
      .replace(/\s*[|:;·•]+\s*$/u, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (next === text) break;
    text = next;
  }
  if (!text || /^transfer[eê]ncia/i.test(text)) return null;
  return text;
}

function resolvePartyName(item: {
  description?: string | null;
  payee?: { name?: string | null } | null;
  beneficiary?: { name?: string | null } | null;
}) {
  const payee = item.payee?.name?.trim() || null;
  const beneficiary = item.beneficiary?.name?.trim() || null;
  const fromDescription = partyFromDescription(item.description);
  if (payee && !/^eu$/i.test(payee)) return payee;
  if (fromDescription) return fromDescription;
  if (beneficiary && !/^eu$/i.test(beneficiary)) return beneficiary;
  return null;
}

function asShareMovement(item: {
  id: string;
  amount: Prisma.Decimal | number;
  description: string;
  transactionDate: Date | string;
  direction: TransactionDirection | string;
  account?: { name?: string | null } | null;
  category?: { name?: string | null } | null;
  payee?: { name?: string | null } | null;
  beneficiary?: { name?: string | null } | null;
  incomeKind?: IncomeKind | string | null;
  notes?: string | null;
  source?: string;
}): ShareMovement {
  const transactionDate =
    typeof item.transactionDate === 'string' ? item.transactionDate.slice(0, 10) : toDateOnlyString(item.transactionDate);
  return {
    id: item.id,
    kind: item.source ? 'projected' : 'actual',
    description: item.description,
    amount: toNumber(item.amount),
    transactionDate,
    direction: item.direction === TransactionDirection.inflow || item.direction === 'inflow' ? 'inflow' : 'outflow',
    accountName: item.account?.name ?? '',
    categoryName: item.category?.name ?? null,
    partyName: resolvePartyName(item),
    incomeKind: item.incomeKind ? String(item.incomeKind) : null,
    role: classifyMovement(item)
  };
}

function toShares(entries: Array<{ label: string; amount: number; movements?: ShareMovement[] }>, total: number) {
  return entries
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((entry) => ({
      label: entry.label,
      amount: entry.amount,
      share: ratio(entry.amount, total),
      movements: [...(entry.movements ?? [])].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.amount - a.amount)
    }));
}

function collectShares(
  items: Array<DashboardTransaction | ProjectedDashboardTransaction>,
  labelOf: (item: DashboardTransaction | ProjectedDashboardTransaction) => string
) {
  const groups = new Map<string, { amount: number; movements: ShareMovement[] }>();
  for (const item of items) {
    const label = labelOf(item);
    const current = groups.get(label) ?? { amount: 0, movements: [] };
    current.amount += toNumber(item.amount);
    current.movements.push(asShareMovement(item));
    groups.set(label, current);
  }
  return groups;
}

function sharesFromGroups(groups: Map<string, { amount: number; movements: ShareMovement[] }>, total: number) {
  return toShares(
    Array.from(groups.entries()).map(([label, value]) => ({
      label,
      amount: value.amount,
      movements: value.movements
    })),
    total
  );
}

function getMovementBudgetType(item: DashboardTransaction | ProjectedDashboardTransaction) {
  if ('budgetType' in item && item.budgetType) return item.budgetType;
  return item.category?.budgetType ?? null;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(query: PeriodQueryDto, userId: string) {
    const ctx = await loadClassificationContext(this.prisma, userId);
    const filtered = await this.prisma.transaction.findMany({
      where: buildTransactionWhere({ ...query, userId }),
      include: {
        category: { select: { budgetType: true, name: true, kind: true } },
        beneficiary: { select: { name: true } },
        payee: { select: { name: true } },
        account: { select: { kind: true, name: true } },
        reimbursementExpenses: { select: { expenseId: true } }
      }
    });
    const projectedTransactions = await this.getProjectedTransactions({ ...query, userId }, filtered, ctx);
    const cardBills = await this.loadCardBills({ ...query, userId });
    const periodMovements = [...filtered, ...projectedTransactions];

    const faturamento = periodMovements
      .filter((item) => isFaturamentoInflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const reembolsos = periodMovements
      .filter((item) => isReimbursementInflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const resgates = periodMovements
      .filter((item) => isResgateInflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const receitas = faturamento + reembolsos + resgates;
    const aplicacoes = periodMovements
      .filter((item) => isAplicacaoOutflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const pagamentosFatura = periodMovements
      .filter((item) => isPagamentoFaturaOutflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const transferenciasProprias = periodMovements
      .filter((item) => isSelfTransferOutflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const despesasConta = periodMovements
      .filter((item) => item.account.kind !== AccountKind.credit_card && isDespesaOutflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const despesasCartao = cardBills.dueTotal;
    const despesas = despesasConta + despesasCartao;
    const saidas = periodMovements
      .filter((item) => isSaidaOutflow(item))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const fixo = periodMovements
      .filter(
        (item) =>
          item.account.kind !== AccountKind.credit_card &&
          isDespesaOutflow(item, ctx) &&
          getMovementBudgetType(item) === BudgetType.fixed
      )
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const variavel = periodMovements
      .filter(
        (item) =>
          item.account.kind !== AccountKind.credit_card &&
          isDespesaOutflow(item, ctx) &&
          getMovementBudgetType(item) === BudgetType.variable
      )
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const despesasOutras = despesasConta;

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
        category: { select: { budgetType: true, name: true, kind: true } },
        beneficiary: { select: { name: true } },
        payee: { select: { name: true } },
        account: { select: { kind: true, name: true } },
        reimbursementExpenses: { select: { expenseId: true } }
      }
    });
    const projectedYearTransactions =
      query.view === 'annual'
        ? projectedTransactions
        : await this.getProjectedTransactions({ ...query, view: 'annual', userId }, yearTransactions, ctx);

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
        .filter((item) => isDespesaOutflow(item, ctx))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthAplicacoes = monthTransactions
        .filter((item) => isAplicacaoOutflow(item, ctx))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthResgates = monthTransactions
        .filter((item) => isResgateInflow(item, ctx))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthSaidas = monthTransactions
        .filter((item) => isSaidaOutflow(item))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthDespesasCartao = monthTransactions
        .filter((item) => item.account.kind === AccountKind.credit_card && isDespesaOutflow(item, ctx))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthDespesasOutras = monthTransactions
        .filter((item) => item.account.kind !== AccountKind.credit_card && isDespesaOutflow(item, ctx))
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthFixo = monthTransactions
        .filter((item) => isDespesaOutflow(item, ctx) && getMovementBudgetType(item) === BudgetType.fixed)
        .reduce((sum, item) => sum + toNumber(item.amount), 0);
      const monthVariavel = monthTransactions
        .filter((item) => isDespesaOutflow(item, ctx) && getMovementBudgetType(item) === BudgetType.variable)
        .reduce((sum, item) => sum + toNumber(item.amount), 0);

      return {
        month: MONTH_LABELS[monthIndex - 1],
        faturamento: monthTransactions
          .filter((item) => isFaturamentoInflow(item, ctx))
          .reduce((sum, item) => sum + toNumber(item.amount), 0),
        reembolsos: monthTransactions
          .filter((item) => isReimbursementInflow(item, ctx))
          .reduce((sum, item) => sum + toNumber(item.amount), 0),
        resgates: monthTransactions
          .filter((item) => isResgateInflow(item, ctx))
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
        if (isReimbursementInflow(item, ctx)) entry.reembolsos += amount;
        else if (isResgateInflow(item, ctx)) {
          entry.resgates += amount;
          entry.aplicacoes -= amount;
        }
        else if (isFaturamentoInflow(item, ctx)) entry.faturamento += amount;
      } else if (isAplicacaoOutflow(item, ctx)) {
        entry.aplicacoes += amount;
        entry.saidas += amount;
      } else if (isDespesaOutflow(item, ctx)) {
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
      include: { category: { select: { budgetType: true, name: true, kind: true } } }
    });
    const aplicacoesTotais = fullPeriodTransactions
      .filter((item) => isAplicacaoOutflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const resgatesTotais = fullPeriodTransactions
      .filter((item) => isResgateInflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const aplicacoesProjetadas = projectedTransactions
      .filter((item) => isAplicacaoOutflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const resgatesProjetados = projectedTransactions
      .filter((item) => isResgateInflow(item, ctx))
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

    const notesItems = periodMovements.filter((item) => isFaturamentoInflow(item, ctx) && isSalaryInflow(item, ctx));
    const otherIncomeItems = periodMovements.filter(
      (item) => (isFaturamentoInflow(item, ctx) && !isSalaryInflow(item, ctx)) || isResgateInflow(item, ctx)
    );
    const notesEmitidas = notesItems.reduce((sum, item) => sum + toNumber(item.amount), 0);
    const outrasEntradas = otherIncomeItems.reduce((sum, item) => sum + toNumber(item.amount), 0);
    const reimbursementGroups = collectShares(
      periodMovements.filter((movement) => isReimbursementInflow(movement, ctx)),
      reimbursementGroupLabel
    );
    const reimbursedIds = new Set(
      filtered.flatMap((item) => [
        ...(item.reimbursementOfId ? [item.reimbursementOfId] : []),
        ...((item as DashboardTransaction).reimbursementExpenses?.map((link) => link.expenseId) ?? [])
      ])
    );
    const reimbursedExpenseAmount = filtered
      .filter((item) => isDespesaOutflow(item, ctx) && (reimbursedIds.has(item.id) || Boolean(item.reimbursementOfId)))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
    const realOutflow = Math.max(despesas - reimbursedExpenseAmount, 0);

    const cashDespesas = periodMovements.filter(
      (movement) => movement.account.kind !== AccountKind.credit_card && isDespesaOutflow(movement, ctx)
    );
    const expenseGroups = collectShares(cashDespesas, expenseGroupLabel);
    if (cardBills.dueTotal > 0) {
      const current = expenseGroups.get('Fatura') ?? { amount: 0, movements: [] };
      current.amount += cardBills.dueTotal;
      current.movements.push(...cardBills.dueMovements);
      expenseGroups.set('Fatura', current);
    }
    if (aplicacoes > 0) {
      const investItems = periodMovements.filter((item) => isAplicacaoOutflow(item, ctx));
      const current = expenseGroups.get('Investimentos') ?? { amount: 0, movements: [] };
      current.amount += aplicacoes;
      current.movements.push(...investItems.map(asShareMovement));
      expenseGroups.set('Investimentos', current);
    }
    const rankedExpenses = sharesFromGroups(
      expenseGroups,
      Array.from(expenseGroups.values()).reduce((sum, item) => sum + item.amount, 0)
    );
    const topExpenseTotal = rankedExpenses.reduce((sum, item) => sum + item.amount, 0);
    const topExpenses =
      rankedExpenses.length <= 5
        ? rankedExpenses
        : [
            ...rankedExpenses.slice(0, 4),
            {
              label: 'Outros',
              amount: rankedExpenses.slice(4).reduce((sum, item) => sum + item.amount, 0),
              share: ratio(
                rankedExpenses.slice(4).reduce((sum, item) => sum + item.amount, 0),
                topExpenseTotal
              ),
              movements: rankedExpenses.slice(4).flatMap((item) => item.movements)
            }
          ];

    const compositionGroups = collectShares(cashDespesas, (item) => displayAccountLabel(item.account?.kind, item.account?.name));
    if (cardBills.dueTotal > 0) {
      const current = compositionGroups.get('Fatura') ?? { amount: 0, movements: [] };
      current.amount += cardBills.dueTotal;
      current.movements.push(...cardBills.dueMovements);
      compositionGroups.set('Fatura', current);
    }
    const composition = sharesFromGroups(compositionGroups, despesas);

    const plan =
      query.view === 'monthly'
        ? await this.buildMonthPlan({ ...query, userId }, ctx, {
            saldoAtual,
            saldoInicial,
            saldoFinal: saldo,
            actuals: filtered
          })
        : null;
    const yearEndPlan =
      query.view === 'annual'
        ? await this.buildMonthPlan(
            { ...query, userId, view: 'monthly', month: query.endMonth },
            ctx,
            {
              saldoAtual,
              saldoInicial,
              saldoFinal: saldo,
              actuals: filtered
            }
          )
        : null;

    const overviewFaturamento = plan?.faturamento ?? faturamento;
    const overviewReembolsos = plan?.reembolsos ?? reembolsos;
    const overviewDespesas = plan?.programado.total ?? despesas;
    const overviewDespesasLiquidas = plan?.programado.liquido ?? Math.max(0, overviewDespesas - overviewReembolsos);
    const overviewSaldoFinal = plan?.saldoFinal ?? yearEndPlan?.saldoFinal ?? saldo;
    const overviewSaldoAtual = plan?.kind === 'future' ? plan.saldoInicial : saldoAtual;

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
      overview: {
        saldoAtual: overviewSaldoAtual,
        saldoFinal: overviewSaldoFinal,
        faturamento: overviewFaturamento,
        reembolsos: overviewReembolsos,
        despesas: overviewDespesas,
        despesasLiquidas: overviewDespesasLiquidas,
        topExpenses,
        composition,
        faturamentoBreakdown:
          plan?.kind === 'future'
            ? toShares(
                [
                  {
                    label: 'Faturamento estimado',
                    amount: overviewFaturamento,
                    movements: periodMovements.filter((item) => isFaturamentoInflow(item, ctx)).map(asShareMovement)
                  }
                ],
                overviewFaturamento
              )
            : toShares(
                [
                  { label: 'Notas emitidas', amount: notesEmitidas, movements: notesItems.map(asShareMovement) },
                  { label: 'Outras entradas', amount: outrasEntradas, movements: otherIncomeItems.map(asShareMovement) }
                ],
                faturamento + resgates
              ),
        reembolsoBreakdown: sharesFromGroups(reimbursementGroups, overviewReembolsos),
        despesaBreakdown: toShares(
          [
            {
              label: 'Fatura',
              amount: plan?.programado.cartao ?? despesasCartao,
              movements: cardBills.dueMovements
            },
            {
              label: 'Gastos fixos',
              amount: plan?.programado.fixos ?? fixo,
              movements: cashDespesas
                .filter((item) => getMovementBudgetType(item) === BudgetType.fixed)
                .map(asShareMovement)
            },
            {
              label: 'Despesas do mês',
              amount: plan?.programado.variaveis ?? variavel,
              movements: cashDespesas
                .filter((item) => getMovementBudgetType(item) !== BudgetType.fixed)
                .map(asShareMovement)
            }
          ],
          overviewDespesas
        )
      },
      plan,
      monthlySeries,
      beneficiarySeries,
      projectedTransactions: projectedTransactions.filter(
        (item) =>
          item.account.kind !== AccountKind.credit_card ||
          item.source === 'card_estimate' ||
          item.source === 'card_open'
      )
    };
  }

  private async getProjectedTransactions(
    query: PeriodQueryDto & { userId: string },
    actualTransactions: DashboardTransaction[],
    ctx: ClassificationContext
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
    const cardBills = await this.loadCardBills(query, range);

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
    const cardIds = accounts.filter((account) => account.kind === AccountKind.credit_card).map((account) => account.id);
    const postedCardCharges =
      cardIds.length === 0
        ? []
        : await this.prisma.transaction.findMany({
            where: {
              accountId: { in: cardIds },
              direction: TransactionDirection.outflow,
              OR: [
                {
                  transactionDate: {
                    gte: new Date(Date.UTC(range.gte.getUTCFullYear(), range.gte.getUTCMonth() - 1, 1)),
                    lte: range.lte
                  }
                },
                { statement: { dueDate: { gte: range.gte, lte: range.lte } } },
                { statement: { closingDate: { gte: today } } }
              ]
            },
            select: { accountId: true, description: true, transactionDate: true }
          });

    const projected = [];

    for (const rule of rules) {
      if (
        rule.frequency !== 'once' &&
        isReimbursementInflow(
          {
            direction: rule.direction,
            description: rule.description,
            category: rule.category,
            account: rule.account,
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
          (rule.frequency === 'monthly' || rule.frequency === 'once') &&
          actualTransactions.some(
            (transaction) =>
              transaction.accountId === rule.accountId &&
              transaction.direction === rule.direction &&
              toDateOnlyString(transaction.transactionDate).slice(0, 7) === dateKey.slice(0, 7) &&
              this.sameRecurringDescription(transaction.description, rule.description)
          );
        const postedOnCard =
          rule.account.kind === AccountKind.credit_card &&
          postedCardCharges.some(
            (charge) =>
              charge.accountId === rule.accountId &&
              toDateOnlyString(charge.transactionDate).slice(0, 7) === dateKey.slice(0, 7) &&
              this.sameRecurringDescription(charge.description, rule.description)
          );
        if (actualKeys.has(actualKey) || actualMonthlyKeys.has(actualMonthlyKey) || hasActualMonthlyMatch || postedOnCard) {
          continue;
        }
        projected.push({
          id: `projected:${rule.id}:${dateKey}`,
          accountId: rule.accountId,
          direction: rule.direction,
          amount: toNumber(rule.amount),
          description: rule.description,
          transactionDate: dateKey,
          paymentMethod: rule.account.kind === AccountKind.credit_card ? PaymentMethod.credit : PaymentMethod.transfer,
          notes: null,
          incomeKind: this.inferProjectedIncomeKind(
            {
              direction: rule.direction,
              description: rule.description,
              category: rule.category,
              account: rule.account,
              beneficiary: rule.beneficiary
            },
            ctx
          ),
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
              isFaturamentoInflow(transaction, ctx)
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
            incomeKind: IncomeKind.salary,
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

    const installmentSources = await this.prisma.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        OR: [{ installmentTotal: { not: null } }, { description: { contains: '/' } }]
      },
      include: {
        account: { select: { id: true, name: true, legalContext: true, kind: true, closingDay: true } },
        category: { select: { id: true, name: true, budgetType: true } },
        beneficiary: { select: { id: true, name: true } }
      }
    });
    const occupiedInstallmentMonths = new Set<string>();
    const seriesLatest = new Map<
      string,
      (typeof installmentSources)[number] & { installmentN: number; installmentTotal: number }
    >();
    for (const source of installmentSources) {
      const parsed = this.parseInstallment(source.description, source.installmentN, source.installmentTotal);
      const seriesKey = this.installmentSeriesKey(source.accountId, source.description);
      occupiedInstallmentMonths.add(`${seriesKey}:${toDateOnlyString(source.transactionDate).slice(0, 7)}`);
      if (parsed.n < 1 || parsed.total < 1) continue;
      const current = seriesLatest.get(seriesKey);
      if (
        !current ||
        parsed.n > current.installmentN ||
        (parsed.n === current.installmentN && source.transactionDate > current.transactionDate)
      ) {
        seriesLatest.set(seriesKey, {
          ...source,
          installmentN: parsed.n,
          installmentTotal: parsed.total
        });
      }
    }
    for (const source of seriesLatest.values()) {
      if (source.account.kind === AccountKind.credit_card) continue;
      if (source.installmentTotal <= source.installmentN) continue;
      const closingDay = source.account.closingDay ?? 0;
      const seriesKey = this.installmentSeriesKey(source.accountId, source.description);
      for (let step = 1; step <= source.installmentTotal - source.installmentN; step += 1) {
        const date = this.nextCardInstallmentDate(source.transactionDate, step, closingDay);
        const isCurrentMonth =
          date.getUTCFullYear() === today.getUTCFullYear() && date.getUTCMonth() === today.getUTCMonth();
        if (date < range.gte || date > range.lte || (!isCurrentMonth && date < today)) continue;
        const dateKey = toDateOnlyString(date);
        const monthKey = `${seriesKey}:${dateKey.slice(0, 7)}`;
        if (occupiedInstallmentMonths.has(monthKey)) continue;
        occupiedInstallmentMonths.add(monthKey);
        const installmentN = source.installmentN + step;
        projected.push({
          id: `projected:installment:${source.id}:${dateKey}`,
          accountId: source.accountId,
          direction: source.direction,
          amount: toNumber(source.amount),
          description: this.withInstallmentLabel(source.description, installmentN, source.installmentTotal),
          transactionDate: dateKey,
          paymentMethod: source.paymentMethod,
          notes: null,
          incomeKind: this.inferProjectedIncomeKind(source, ctx),
          account: source.account,
          budgetType: source.category?.budgetType ?? null,
          category: source.category,
          beneficiary: source.beneficiary,
          source: 'installment' as const
        });
      }
    }

    projected.push(...cardBills.items);

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

  private stripInstallmentLabel(value: string) {
    return value.replace(/\b\d+\s*\/\s*\d+\b/g, '').replace(/\s+/g, ' ').trim();
  }

  private installmentSeriesKey(accountId: string, description: string) {
    return `${accountId}:${this.normalizeDescription(this.stripInstallmentLabel(description))}`;
  }

  private parseInstallment(description: string, installmentN: number | null, installmentTotal: number | null) {
    if (installmentN && installmentTotal) {
      return { n: installmentN, total: installmentTotal };
    }
    const match = description.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (!match) return { n: installmentN ?? 0, total: installmentTotal ?? 0 };
    return { n: Number(match[1]), total: Number(match[2]) };
  }

  private withInstallmentLabel(description: string, n: number, total: number) {
    if (/\b\d+\s*\/\s*\d+\b/.test(description)) {
      return description.replace(/\b\d+\s*\/\s*\d+\b/, `${n}/${total}`);
    }
    return `${description} ${n}/${total}`;
  }

  private nextCardInstallmentDate(sourceDate: Date, step: number, closingDay: number) {
    const date = new Date(
      Date.UTC(sourceDate.getUTCFullYear(), sourceDate.getUTCMonth() + step, sourceDate.getUTCDate())
    );
    if (closingDay > 0 && date.getUTCDate() <= closingDay) {
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), closingDay + 1));
    }
    return date;
  }

  private inferProjectedIncomeKind(
    item: {
      direction: TransactionDirection | string;
      description?: string | null;
      incomeKind?: IncomeKind | string | null;
      category?: { name?: string | null; kind?: string | null } | null;
      account?: { kind?: string | null; name?: string | null } | null;
      beneficiary?: { name?: string | null } | null;
    },
    ctx: ClassificationContext
  ) {
    if (item.direction !== TransactionDirection.inflow && item.direction !== 'inflow') return null;
    if (isReimbursementInflow(item, ctx)) return IncomeKind.reimbursement;
    if (isFaturamentoInflow(item, ctx)) return IncomeKind.salary;
    return null;
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
        if (transaction.account.kind === AccountKind.credit_card) return false;
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

  private splitProgramado(
    actuals: DashboardTransaction[],
    projected: ProjectedDashboardTransaction[],
    ctx: ClassificationContext
  ) {
    let fixos = 0;
    let variaveis = 0;
    for (const item of [...actuals, ...projected]) {
      if (!isDespesaOutflow(item, ctx)) continue;
      if (item.account?.kind === AccountKind.credit_card) continue;
      const amount = toNumber(item.amount);
      if (getMovementBudgetType(item) === BudgetType.fixed) fixos += amount;
      else variaveis += amount;
    }
    return { cartao: 0, fixos, variaveis, total: fixos + variaveis, liquido: fixos + variaveis };
  }

  private withNetProgramado(
    programado: {
      cartao: number;
      cartaoAberto?: number;
      fixos: number;
      variaveis: number;
      total: number;
      liquido: number;
    },
    reembolsos: number
  ) {
    return {
      ...programado,
      cartaoAberto: programado.cartaoAberto ?? 0,
      liquido: Math.max(0, programado.total - reembolsos)
    };
  }

  private async loadCardBills(query: PeriodQueryDto & { userId: string }, range?: { gte: Date; lte: Date }) {
    const period = range ?? periodRangeUTC(query.year, query.month, query.view, query.startMonth, query.endMonth);
    const accountWhere = query.accountId
      ? { id: query.accountId }
      : query.accountScope !== 'all'
        ? { legalContext: query.accountScope }
        : {};
    const cards = await this.prisma.financialAccount.findMany({
      where: { ...accountWhere, isActive: true, userId: query.userId, kind: AccountKind.credit_card },
      select: { id: true, name: true, legalContext: true, kind: true }
    });
    const empty = { dueTotal: 0, dueRemaining: 0, openTotal: 0, items: [] as ProjectedDashboardTransaction[], dueMovements: [] as ShareMovement[] };
    if (cards.length === 0) return empty;

    const statements = await this.prisma.creditCardStatement.findMany({
      where: { accountId: { in: cards.map((card) => card.id) } },
      include: {
        transactions: {
          select: {
            id: true,
            amount: true,
            description: true,
            transactionDate: true,
            direction: true,
            account: { select: { name: true } },
            category: { select: { id: true, name: true, budgetType: true } }
          },
          orderBy: { transactionDate: 'desc' }
        }
      }
    });
    const previous = addYearMonth({ year: query.year, month: query.month }, -1);
    const previousRange = monthRangeUTC(previous.year, previous.month);
    const cardById = new Map(cards.map((card) => [card.id, card]));
    let dueTotal = 0;
    let dueRemaining = 0;
    const items: ProjectedDashboardTransaction[] = [];
    const dueMovements: ShareMovement[] = [];

    for (const card of cards) {
      const cardStatements = statements.filter((statement) => statement.accountId === card.id);
      const dueThisMonth = cardStatements.filter(
        (statement) => statement.dueDate >= period.gte && statement.dueDate <= period.lte
      );
      const lastMonthOpen = cardStatements.filter(
        (statement) =>
          statement.referenceMonth >= previousRange.gte &&
          statement.referenceMonth <= previousRange.lte
      );
      const payable = dueThisMonth.length > 0 ? dueThisMonth : lastMonthOpen;
      for (const statement of payable) {
        const total = toNumber(statement.totalAmount);
        const remaining = Math.max(0, total - toNumber(statement.paidAmount));
        if (total <= 0) continue;
        dueTotal += total;
        const charges = statement.transactions.filter((transaction) => transaction.direction !== TransactionDirection.inflow);
        if (charges.length > 0) {
          dueMovements.push(...charges.map((transaction) => asShareMovement({ ...transaction, account: card })));
        } else {
          dueMovements.push({
            id: `statement:${statement.id}`,
            kind: 'projected',
            description: `Fatura ${card.name}`,
            amount: total,
            transactionDate: toDateOnlyString(statement.dueDate),
            direction: 'outflow',
            accountName: card.name,
            categoryName: 'Fatura',
            partyName: null,
            incomeKind: null,
            role: 'despesa'
          });
        }
        if (!statement.isPaid && remaining > 0) {
          dueRemaining += remaining;
          const dueDate = toDateOnlyString(statement.dueDate);
          const fullyOpen = Math.abs(remaining - total) < 0.009;
          if (charges.length > 0 && fullyOpen) {
            for (const charge of charges) {
              items.push({
                id: `projected:card-due:${statement.id}:${charge.id}`,
                accountId: card.id,
                direction: TransactionDirection.outflow,
                paymentMethod: PaymentMethod.credit,
                amount: toNumber(charge.amount),
                description: charge.description,
                transactionDate: dueDate,
                notes: null,
                incomeKind: null,
                account: card,
                budgetType: charge.category?.budgetType ?? BudgetType.variable,
                category: charge.category
                  ? {
                      id: charge.category.id,
                      name: charge.category.name,
                      budgetType: charge.category.budgetType
                    }
                  : null,
                beneficiary: null,
                source: 'card_estimate'
              });
            }
          } else {
            items.push({
              id: `projected:card-due:${statement.id}`,
              accountId: card.id,
              direction: TransactionDirection.outflow,
              paymentMethod: PaymentMethod.credit,
              amount: remaining,
              description: 'Fatura',
              transactionDate: dueDate,
              notes: null,
              incomeKind: null,
              account: card,
              budgetType: BudgetType.fixed,
              category: null,
              beneficiary: null,
              source: 'card_estimate'
            });
          }
        }
      }
    }

    return { dueTotal, dueRemaining, openTotal: 0, items, dueMovements };
  }

  private monthFaturamento(
    actuals: DashboardTransaction[],
    projected: ProjectedDashboardTransaction[],
    ctx: ClassificationContext
  ) {
    return [...actuals, ...projected]
      .filter((item) => isFaturamentoInflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
  }

  private monthReimbursements(
    actuals: DashboardTransaction[],
    projected: ProjectedDashboardTransaction[],
    ctx: ClassificationContext
  ) {
    return [...actuals, ...projected]
      .filter((item) => isReimbursementInflow(item, ctx))
      .reduce((sum, item) => sum + toNumber(item.amount), 0);
  }

  private monthIncome(
    actuals: DashboardTransaction[],
    projected: ProjectedDashboardTransaction[],
    ctx: ClassificationContext
  ) {
    return this.monthFaturamento(actuals, projected, ctx) + this.monthReimbursements(actuals, projected, ctx);
  }

  private async cardSpendAverage(accountIds: string[], current: YearMonth, ctx: ClassificationContext) {
    if (accountIds.length === 0) return 0;
    const start = addYearMonth(current, -3);
    const rows = await this.prisma.transaction.findMany({
      where: {
        accountId: { in: accountIds },
        transactionDate: {
          gte: monthRangeUTC(start.year, start.month).gte,
          lt: monthRangeUTC(current.year, current.month).gte
        }
      },
      include: {
        account: { select: { kind: true, name: true } },
        category: { select: { name: true, kind: true, budgetType: true } }
      }
    });
    const totals = new Map<string, number>();
    for (const item of rows) {
      if (item.account.kind !== AccountKind.credit_card || !isDespesaOutflow(item, ctx)) continue;
      const key = toDateOnlyString(item.transactionDate).slice(0, 7);
      totals.set(key, (totals.get(key) ?? 0) + toNumber(item.amount));
    }
    if (totals.size === 0) return 0;
    return Array.from(totals.values()).reduce((sum, value) => sum + value, 0) / totals.size;
  }

  private async buildMonthPlan(
    query: PeriodQueryDto & { userId: string },
    ctx: ClassificationContext,
    snapshot: {
      saldoAtual: number;
      saldoInicial: number;
      saldoFinal: number;
      actuals: DashboardTransaction[];
    }
  ) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const current: YearMonth = { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
    const viewed: YearMonth = { year: query.year, month: query.month };
    const kind =
      compareYearMonth(viewed, current) < 0 ? 'past' : compareYearMonth(viewed, current) === 0 ? 'current' : 'future';
    const previous = addYearMonth(viewed, -1);

    if (kind === 'past') {
      const reembolsos = this.monthReimbursements(snapshot.actuals, [], ctx);
      const split = this.splitProgramado(snapshot.actuals, [], ctx);
      const bills = await this.loadCardBills(query);
      const programado = this.withNetProgramado(
        {
          cartao: bills.dueTotal,
          cartaoAberto: bills.openTotal,
          fixos: split.fixos,
          variaveis: split.variaveis,
          total: bills.dueTotal + split.fixos + split.variaveis,
          liquido: 0
        },
        reembolsos
      );
      return {
        kind,
        fromPreviousLabel: monthLabel(previous),
        saldoInicial: snapshot.saldoInicial,
        faturamento: this.monthFaturamento(snapshot.actuals, [], ctx),
        reembolsos,
        programado,
        saldoFinal: snapshot.saldoFinal
      };
    }

    const accountWhere = query.accountId
      ? { id: query.accountId }
      : query.accountScope !== 'all'
        ? { legalContext: query.accountScope }
        : {};
    const accounts = await this.prisma.financialAccount.findMany({
      where: { ...accountWhere, isActive: true, userId: query.userId },
      select: { id: true }
    });
    const accountIds = accounts.map((account) => account.id);
    const cardAverage = await this.cardSpendAverage(accountIds, current, ctx);
    const include = {
      category: { select: { budgetType: true, name: true, kind: true } as const },
      beneficiary: { select: { name: true } as const },
      account: { select: { kind: true, name: true } as const },
      reimbursementExpenses: { select: { expenseId: true } as const }
    };

    let runningEnd = snapshot.saldoAtual;
    let cursor = current;
    let result = {
      kind,
      fromPreviousLabel: monthLabel(previous),
      saldoInicial: snapshot.saldoInicial,
      faturamento: this.monthFaturamento(snapshot.actuals, [], ctx),
      reembolsos: this.monthReimbursements(snapshot.actuals, [], ctx),
      programado: this.withNetProgramado(
        this.splitProgramado(snapshot.actuals, [], ctx),
        this.monthReimbursements(snapshot.actuals, [], ctx)
      ),
      saldoFinal: snapshot.saldoAtual
    };

    while (compareYearMonth(cursor, viewed) <= 0) {
      const range = monthRangeUTC(cursor.year, cursor.month);
      const monthActuals =
        compareYearMonth(cursor, viewed) === 0 && kind === 'current'
          ? snapshot.actuals
          : ((await this.prisma.transaction.findMany({
              where: {
                accountId: { in: accountIds },
                transactionDate: { gte: range.gte, lte: range.lte }
              },
              include
            })) as DashboardTransaction[]);
      const projected = await this.getProjectedTransactions(
        { ...query, year: cursor.year, month: cursor.month, view: 'monthly' },
        monthActuals,
        ctx
      );
      const programadoRaw = this.splitProgramado(monthActuals, projected, ctx);
      const bills = await this.loadCardBills(
        { ...query, year: cursor.year, month: cursor.month, view: 'monthly' },
        range
      );
      const income = this.monthFaturamento(monthActuals, projected, ctx);
      const reembolsos = this.monthReimbursements(monthActuals, projected, ctx);
      const isCurrent = compareYearMonth(cursor, current) === 0;
      let cartao = bills.dueTotal;
      if (!isCurrent && cartao === 0 && cardAverage > 0) cartao = cardAverage;
      const programado = this.withNetProgramado(
        {
          cartao,
          cartaoAberto: bills.openTotal,
          fixos: programadoRaw.fixos,
          variaveis: programadoRaw.variaveis,
          total: cartao + programadoRaw.fixos + programadoRaw.variaveis,
          liquido: 0
        },
        reembolsos
      );

      const opening = isCurrent ? snapshot.saldoAtual : runningEnd;
      const remainingIncome =
        this.monthFaturamento([], projected, ctx) + this.monthReimbursements([], projected, ctx);
      const checkingRemaining = this.splitProgramado([], projected, ctx).total;
      const ending = isCurrent
        ? snapshot.saldoAtual + remainingIncome - bills.dueRemaining - checkingRemaining
        : opening + income + reembolsos - programado.total;
      runningEnd = ending;

      if (compareYearMonth(cursor, viewed) === 0) {
        result = {
          kind,
          fromPreviousLabel: monthLabel(previous),
          saldoInicial: isCurrent ? snapshot.saldoInicial : opening,
          faturamento: income,
          reembolsos,
          programado,
          saldoFinal: ending
        };
      }
      cursor = addYearMonth(cursor, 1);
    }

    return result;
  }
}
