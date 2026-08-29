import { CreditCardStatement } from '@prisma/client';
import { toDateOnlyString } from '../../common/utils/date.util';
import { toNumber } from '../../common/utils/decimal.util';

export interface StatementResponse {
  id: string;
  accountId: string;
  referenceMonth: string;
  closingDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  isPaid: boolean;
}

export function toStatementResponse(statement: CreditCardStatement): StatementResponse {
  return {
    id: statement.id,
    accountId: statement.accountId,
    referenceMonth: toDateOnlyString(statement.referenceMonth),
    closingDate: toDateOnlyString(statement.closingDate),
    dueDate: toDateOnlyString(statement.dueDate),
    totalAmount: toNumber(statement.totalAmount),
    paidAmount: toNumber(statement.paidAmount),
    isPaid: statement.isPaid
  };
}
