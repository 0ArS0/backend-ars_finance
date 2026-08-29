import { TransactionDirection } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { toNumber } from './decimal.util';

export type MovementRow = {
  direction: TransactionDirection | string;
  amount: Decimal | number | string;
};

export function netMovement(transactions: MovementRow[]): number {
  return transactions.reduce((sum, item) => {
    const amount = toNumber(item.amount);
    return sum + (item.direction === TransactionDirection.inflow ? amount : -amount);
  }, 0);
}
