import { Goal, GoalLink } from '@prisma/client';
import { toDateOnlyString } from '../../common/utils/date.util';
import { toNumber } from '../../common/utils/decimal.util';
import { monthlyNeeded } from '../../common/utils/finance.util';

export function toGoalResponse(goal: Goal & { links?: GoalLink[] }, allocated: number) {
  const target = toNumber(goal.targetAmount);
  const remaining = Math.max(target - allocated, 0);
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: target,
    targetDate: goal.targetDate ? toDateOnlyString(goal.targetDate) : null,
    priority: goal.priority,
    isActive: goal.isActive,
    allocated,
    remaining,
    monthlyNeeded: monthlyNeeded(remaining, goal.targetDate),
    links: (goal.links ?? []).map((link) => ({
      id: link.id,
      title: link.title,
      url: link.url,
      context: link.context
    }))
  };
}
