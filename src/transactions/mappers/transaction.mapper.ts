import {
  IncomeKind,
  PaymentMethod,
  Prisma,
  Transaction as PrismaTransaction,
  TransactionDirection
} from '@prisma/client';
import { periodRangeUTC, toDateOnlyString } from '../../common/utils/date.util';
import { toNumber } from '../../common/utils/decimal.util';

export interface TransactionResponse {
  id: string;
  accountId: string;
  direction: TransactionDirection;
  paymentMethod: PaymentMethod;
  amount: number;
  description: string;
  notes: string | null;
  transactionDate: string;
  postedDate: string | null;
  dueDate: string | null;
  incomeKind: IncomeKind | null;
  categoryId: string | null;
  payeeId: string | null;
  beneficiaryId: string | null;
  reimbursementOfId: string | null;
  reimbursementOfIds: string[];
  statementId: string | null;
  account?: { id: string; name: string; legalContext: string; kind: string };
  category?: { id: string; name: string; budgetType: string | null } | null;
  payee?: { id: string; name: string } | null;
  beneficiary?: { id: string; name: string } | null;
  reimbursementOf?: { id: string; description: string; amount: number; transactionDate: string } | null;
  reimbursementExpenses?: { id: string; description: string; amount: number; transactionDate: string }[];
}

type TransactionWithRelations = PrismaTransaction & {
  account?: { id: string; name: string; legalContext: string; kind: string };
  category?: { id: string; name: string; budgetType: string | null } | null;
  payee?: { id: string; name: string } | null;
  beneficiary?: { id: string; name: string } | null;
  reimbursementOf?: { id: string; description: string; amount: Prisma.Decimal; transactionDate: Date } | null;
  reimbursementExpenses?: {
    expense: { id: string; description: string; amount: Prisma.Decimal; transactionDate: Date };
  }[];
};

export function toTransactionResponse(record: TransactionWithRelations): TransactionResponse {
  return {
    id: record.id,
    accountId: record.accountId,
    direction: record.direction,
    paymentMethod: record.paymentMethod,
    amount: toNumber(record.amount),
    description: record.description,
    notes: record.notes,
    transactionDate: toDateOnlyString(record.transactionDate),
    postedDate: record.postedDate ? toDateOnlyString(record.postedDate) : null,
    dueDate: record.dueDate ? toDateOnlyString(record.dueDate) : null,
    incomeKind: record.incomeKind,
    categoryId: record.categoryId,
    payeeId: record.payeeId,
    beneficiaryId: record.beneficiaryId,
    reimbursementOfId: record.reimbursementOfId,
    reimbursementOfIds: record.reimbursementExpenses?.map((item) => item.expense.id) ?? (
      record.reimbursementOfId ? [record.reimbursementOfId] : []
    ),
    statementId: record.statementId,
    account: record.account,
    category: record.category,
    payee: record.payee,
    beneficiary: record.beneficiary,
    reimbursementOf: record.reimbursementOf
      ? {
          id: record.reimbursementOf.id,
          description: record.reimbursementOf.description,
          amount: toNumber(record.reimbursementOf.amount),
          transactionDate: toDateOnlyString(record.reimbursementOf.transactionDate)
        }
      : null,
    reimbursementExpenses: record.reimbursementExpenses?.map((item) => ({
      id: item.expense.id,
      description: item.expense.description,
      amount: toNumber(item.expense.amount),
      transactionDate: toDateOnlyString(item.expense.transactionDate)
    })) ?? []
  };
}

export function buildTransactionWhere(query: {
  accountScope: 'all' | 'pf' | 'pj';
  month: number;
  year: number;
  view: 'monthly' | 'annual';
  userId?: string;
  startMonth?: number;
  endMonth?: number;
  accountId?: string;
  legalContext?: 'pf' | 'pj';
  categoryId?: string;
  beneficiaryId?: string;
  paymentMethod?: PaymentMethod;
}): Prisma.TransactionWhereInput {
  const range = periodRangeUTC(query.year, query.month, query.view, query.startMonth, query.endMonth);
  const where: Prisma.TransactionWhereInput = { transactionDate: range };

  if (query.accountId) {
    where.account = { id: query.accountId, ...(query.userId ? { userId: query.userId } : {}) };
  } else if (query.legalContext) {
    where.account = { legalContext: query.legalContext, ...(query.userId ? { userId: query.userId } : {}) };
  } else if (query.accountScope !== 'all') {
    where.account = { legalContext: query.accountScope, ...(query.userId ? { userId: query.userId } : {}) };
  } else if (query.userId) {
    where.account = { userId: query.userId };
  }

  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.beneficiaryId) where.beneficiaryId = query.beneficiaryId;
  if (query.paymentMethod) where.paymentMethod = query.paymentMethod;

  return where;
}
