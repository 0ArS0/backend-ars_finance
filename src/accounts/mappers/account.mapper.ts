import { AccountKind, FinancialAccount, LegalContext } from '@prisma/client';
import { toNumber } from '../../common/utils/decimal.util';

export interface AccountResponse {
  id: string;
  name: string;
  kind: AccountKind;
  legalContext: LegalContext;
  currency: string;
  openingBalance: number;
  isActive: boolean;
  creditLimit: number | null;
  closingDay: number | null;
  dueDay: number | null;
}

export function toAccountResponse(account: FinancialAccount): AccountResponse {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    legalContext: account.legalContext,
    currency: account.currency,
    openingBalance: toNumber(account.openingBalance),
    isActive: account.isActive,
    creditLimit: account.creditLimit ? toNumber(account.creditLimit) : null,
    closingDay: account.closingDay,
    dueDay: account.dueDay
  };
}
