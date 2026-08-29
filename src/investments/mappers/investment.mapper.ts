import { InvestmentAccount, InvestmentHolding, InvestmentTransaction } from '@prisma/client';
import { toDateOnlyString } from '../../common/utils/date.util';
import { toNumber } from '../../common/utils/decimal.util';

export function toInvestmentAccountResponse(account: InvestmentAccount) {
  return {
    id: account.id,
    name: account.name,
    legalContext: account.legalContext
  };
}

export function toHoldingResponse(holding: InvestmentHolding) {
  return {
    id: holding.id,
    accountId: holding.accountId,
    assetSymbol: holding.assetSymbol,
    assetName: holding.assetName,
    quantity: toNumber(holding.quantity),
    avgPrice: toNumber(holding.avgPrice),
    assetClass: holding.assetClass,
    currentValue:
      holding.currentValue == null
        ? toNumber(holding.quantity) * toNumber(holding.avgPrice)
        : toNumber(holding.currentValue)
  };
}

export function toInvestmentTransactionResponse(tx: InvestmentTransaction) {
  return {
    id: tx.id,
    accountId: tx.accountId,
    type: tx.type,
    assetSymbol: tx.assetSymbol,
    assetName: tx.assetName,
    quantity: toNumber(tx.quantity),
    unitPrice: toNumber(tx.unitPrice),
    totalAmount: toNumber(tx.totalAmount),
    occurredAt: toDateOnlyString(tx.occurredAt)
  };
}
