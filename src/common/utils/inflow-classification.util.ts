import { CategoryKind, ImportMatchType, IncomeKind, TransactionDirection } from '@prisma/client';
import { ImportRuleRecord, matchesRule } from '../../imports/parsers/nubank.parser';

export type MovementRole =
  | 'faturamento'
  | 'reembolso'
  | 'resgate'
  | 'ajuste_entrada'
  | 'despesa'
  | 'aplicacao'
  | 'pagamento_fatura'
  | 'transferencia';

export type MovementLike = {
  direction: TransactionDirection | string;
  incomeKind?: IncomeKind | string | null;
  description?: string | null;
  notes?: string | null;
  category?: { name?: string | null; kind?: CategoryKind | string | null } | null;
  account?: { kind?: string | null; name?: string | null } | null;
  payee?: { name?: string | null } | null;
};

export type ClassificationContext = {
  rules?: Array<
    Pick<ImportRuleRecord, 'pattern' | 'matchType' | 'incomeKind' | 'skip' | 'priority' | 'label'> & {
      category?: { name?: string | null; kind?: string | null } | null;
      beneficiary?: { slug?: string | null } | null;
    }
  >;
  ownNames?: string[];
};

function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function movementText(item: MovementLike) {
  return fold(
    `${item.description ?? ''} ${item.notes ?? ''} ${item.category?.name ?? ''} ${item.payee?.name ?? ''}`
  );
}

function matchingRule(item: MovementLike, ctx?: ClassificationContext) {
  const rules = [...(ctx?.rules ?? [])].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
  const description = `${item.description ?? ''} ${item.notes ?? ''} ${item.payee?.name ?? ''}`;
  return rules.find((rule) =>
    matchesRule(description, {
      ...rule,
      matchType: rule.matchType ?? ImportMatchType.contains
    } as ImportRuleRecord)
  );
}

export function classifyMovement(item: MovementLike, ctx?: ClassificationContext): MovementRole {
  const text = movementText(item);
  const categoryName = fold(item.category?.name ?? '');
  const categoryKind = fold(String(item.category?.kind ?? ''));
  const rule = matchingRule(item, ctx);
  const incomeKind = item.incomeKind ?? rule?.incomeKind ?? null;
  const isInflow = item.direction === TransactionDirection.inflow || item.direction === 'inflow';

  if (isInflow) {
    if (incomeKind === IncomeKind.reimbursement || /reembolso/.test(text)) return 'reembolso';
    if (
      rule?.beneficiary?.slug &&
      rule.beneficiary.slug !== 'eu' &&
      incomeKind !== IncomeKind.salary &&
      incomeKind !== IncomeKind.freelance &&
      incomeKind !== IncomeKind.bonus
    ) {
      return 'reembolso';
    }
    if (
      /resgate\s*rdb|resgate.*caixinha/.test(text) ||
      (categoryName === 'reserva' && /resgate/.test(text)) ||
      (categoryKind === 'transfer' && categoryName === 'reserva' && !/aplicacao|rdb/.test(text) && /resgate/.test(text))
    ) {
      return 'resgate';
    }
    if (categoryName === 'reserva' && (categoryKind === 'transfer' || /invest/.test(text))) return 'resgate';
    if (/valor adicionado|pix no credito|estorno|credito em conta/.test(text)) return 'ajuste_entrada';
    if (categoryKind === 'transfer' || categoryName === 'transferencia propria' || categoryName === 'transferencias') {
      return 'ajuste_entrada';
    }
    return 'faturamento';
  }

  if (
    /pagamento de fatura|pagamento.*cartao/.test(text) ||
    categoryName === 'pagamento cartao' ||
    (rule?.category?.name && fold(rule.category.name) === 'pagamento cartao')
  ) {
    return 'pagamento_fatura';
  }
  if (
    /aplicao?\s*rdb|aplicacao\s*rdb|aplicacao.*caixinha|guardar.*caixinha/.test(text) ||
    categoryName === 'reserva' ||
    item.account?.kind === 'investment'
  ) {
    return 'aplicacao';
  }
  if (categoryKind === 'transfer' || categoryName === 'transferencia propria' || categoryName === 'transferencias') {
    return 'transferencia';
  }
  if (rule?.skip) return 'transferencia';
  const ownNames = (ctx?.ownNames ?? []).map(fold).filter((name) => name.length > 5);
  if (ownNames.some((name) => text.includes(name))) return 'transferencia';
  return 'despesa';
}

export function isSalaryInflow(item: MovementLike, ctx?: ClassificationContext) {
  if (item.direction !== TransactionDirection.inflow && item.direction !== 'inflow') return false;
  if (item.incomeKind === IncomeKind.salary || item.incomeKind === IncomeKind.freelance) return true;
  const rule = matchingRule(item, ctx);
  return rule?.incomeKind === IncomeKind.salary || rule?.incomeKind === IncomeKind.freelance;
}

export function isReimbursementInflow(item: MovementLike, ctx?: ClassificationContext) {
  return classifyMovement(item, ctx) === 'reembolso';
}

export function isResgateInflow(item: MovementLike, ctx?: ClassificationContext) {
  return classifyMovement(item, ctx) === 'resgate';
}

export function isCreditTopupInflow(item: MovementLike, ctx?: ClassificationContext) {
  return classifyMovement(item, ctx) === 'ajuste_entrada' && /valor adicionado|pix no credito/.test(movementText(item));
}

export function isEstornoInflow(item: MovementLike) {
  return /estorno/.test(movementText(item));
}

export function isCreditoEmContaInflow(item: MovementLike) {
  return /credito em conta/.test(movementText(item));
}

export function isAplicacaoOutflow(item: MovementLike, ctx?: ClassificationContext) {
  return classifyMovement(item, ctx) === 'aplicacao';
}

export function isPagamentoFaturaOutflow(item: MovementLike, ctx?: ClassificationContext) {
  return classifyMovement(item, ctx) === 'pagamento_fatura';
}

export function isSelfTransferOutflow(item: MovementLike, ctx?: ClassificationContext) {
  return classifyMovement(item, ctx) === 'transferencia';
}

export function isTransferOutflow(item: MovementLike, ctx?: ClassificationContext) {
  const role = classifyMovement(item, ctx);
  return role === 'aplicacao' || role === 'transferencia' || role === 'pagamento_fatura';
}

export function isFaturamentoInflow(item: MovementLike, ctx?: ClassificationContext) {
  return classifyMovement(item, ctx) === 'faturamento';
}

export function isDespesaOutflow(item: MovementLike, ctx?: ClassificationContext) {
  return classifyMovement(item, ctx) === 'despesa';
}

export function isSaidaOutflow(item: MovementLike) {
  return item.direction === TransactionDirection.outflow || item.direction === 'outflow';
}

function humanizeLabel(value: string) {
  const cleaned = value.replace(/[_]+/g, '-').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(cleaned) && !/^[a-z]{3,}$/.test(cleaned)) return value.trim();
  return cleaned
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function expenseGroupLabel(item: MovementLike) {
  if (item.account?.kind === 'credit_card') {
    const raw = humanizeLabel((item.account.name ?? '').replace(/\s+/g, ' ').trim());
    if (!raw) return 'Cartão';
    if (/^cart[aã]o\b/i.test(raw)) return raw;
    return `Cartão ${raw}`;
  }
  const category = item.category?.name?.trim();
  if (category) return humanizeLabel(category);
  return 'Outras despesas';
}
