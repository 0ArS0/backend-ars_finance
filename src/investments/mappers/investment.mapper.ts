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
  const quantity = toNumber(holding.quantity);
  const avgPrice = toNumber(holding.avgPrice);
  const investedAmount =
    holding.investedAmount == null ? Math.round(quantity * avgPrice * 100) / 100 : toNumber(holding.investedAmount);
  return {
    id: holding.id,
    accountId: holding.accountId,
    assetSymbol: holding.assetSymbol,
    assetName: holding.assetName,
    quantity,
    avgPrice,
    investedAmount,
    assetClass: holding.assetClass,
    currentValue:
      holding.currentValue == null ? investedAmount : toNumber(holding.currentValue)
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
