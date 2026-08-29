import { IncomeKind, TransactionDirection } from '@prisma/client';

type MovementLike = {
  direction: TransactionDirection | string;
  incomeKind?: IncomeKind | string | null;
  description?: string | null;
  notes?: string | null;
  category?: { name?: string | null } | null;
};

function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function movementText(item: MovementLike) {
  return fold(`${item.description ?? ''} ${item.notes ?? ''} ${item.category?.name ?? ''}`);
}

export function isSalaryInflow(item: MovementLike) {
  if (item.direction !== TransactionDirection.inflow) return false;
  const text = movementText(item);
  const digits = text.replace(/\D/g, '');
  return digits.includes('65561571000140') || /65\s*561\s*571/.test(text);
}

export function isReimbursementInflow(item: MovementLike) {
  if (item.direction !== TransactionDirection.inflow) return false;
  if (isSalaryInflow(item)) return false;
  if (item.incomeKind === IncomeKind.reimbursement) return true;

  const text = movementText(item);
  if (/reembolso/.test(text)) return true;
  return /(?:sergio(?:\s+da\s+silva\s+monteiro)?|dilma(?:\s+cosmo)?|\blyza\b|eliseu)/.test(text);
}

export function isResgateInflow(item: MovementLike) {
  if (item.direction !== TransactionDirection.inflow) return false;
  if (isReimbursementInflow(item)) return false;

  const text = movementText(item);
  if (/resgate\s*rdb|resgate.*caixinha/.test(text)) return true;

  return item.category?.name ? fold(item.category.name) === 'reserva' && /resgate/.test(text) : false;
}

export function isCreditTopupInflow(item: MovementLike) {
  if (item.direction !== TransactionDirection.inflow) return false;
  return /valor adicionado|pix no credito/.test(movementText(item));
}

export function isEstornoInflow(item: MovementLike) {
  if (item.direction !== TransactionDirection.inflow) return false;
  return /estorno/.test(movementText(item));
}

export function isCreditoEmContaInflow(item: MovementLike) {
  if (item.direction !== TransactionDirection.inflow) return false;
  if (isSalaryInflow(item)) return false;
  const raw = `${item.description ?? ''} ${item.notes ?? ''}`;
  return /cr[eé\uFFFD]?dito em conta/i.test(raw) || /credito em conta/.test(movementText(item));
}

export function isAplicacaoOutflow(item: MovementLike) {
  if (item.direction !== TransactionDirection.outflow) return false;

  const text = movementText(item);
  if (/aplicao?\s*rdb|aplicacao\s*rdb|aplicacao.*caixinha|guardar.*caixinha/.test(text)) return true;

  return item.category?.name ? fold(item.category.name) === 'reserva' && /aplicacao|rdb/.test(text) : false;
}

export function isPagamentoFaturaOutflow(item: MovementLike) {
  if (item.direction !== TransactionDirection.outflow) return false;

  const text = movementText(item);
  if (/pagamento de fatura/.test(text)) return true;

  return fold(item.category?.name ?? '') === 'pagamento cartao';
}

export function isSelfTransferOutflow(item: MovementLike) {
  if (item.direction !== TransactionDirection.outflow) return false;

  const text = movementText(item);
  if (!/arthur da silva monteiro/.test(text)) return false;
  if (/lyza\s*-/.test(text)) return false;

  const digits = text.replace(/\D/g, '');
  if (digits.includes('65561571000140') || /65\s*561\s*571/.test(text)) return false;

  return true;
}

export function isTransferOutflow(item: MovementLike) {
  return isAplicacaoOutflow(item) || isSelfTransferOutflow(item);
}

export function isFaturamentoInflow(item: MovementLike) {
  return (
    item.direction === TransactionDirection.inflow &&
    !isReimbursementInflow(item) &&
    !isResgateInflow(item) &&
    !isCreditTopupInflow(item) &&
    !isEstornoInflow(item) &&
    !isCreditoEmContaInflow(item)
  );
}

export function isDespesaOutflow(item: MovementLike) {
  return item.direction === TransactionDirection.outflow && !isTransferOutflow(item);
}

export function isSaidaOutflow(item: MovementLike) {
  return item.direction === TransactionDirection.outflow;
}
