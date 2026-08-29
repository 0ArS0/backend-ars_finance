import { RecurringRule } from '@prisma/client';
import { toDateOnlyString } from '../../common/utils/date.util';
import { toNumber } from '../../common/utils/decimal.util';

export function toRecurringRuleResponse(rule: RecurringRule) {
  return {
    id: rule.id,
    accountId: rule.accountId,
    direction: rule.direction,
    amount: toNumber(rule.amount),
    description: rule.description,
    frequency: rule.frequency,
    dayOfMonth: rule.dayOfMonth,
    startDate: toDateOnlyString(rule.startDate),
    endDate: rule.endDate ? toDateOnlyString(rule.endDate) : null,
    budgetType: rule.budgetType,
    categoryId: rule.categoryId,
    beneficiaryId: rule.beneficiaryId
  };
}
