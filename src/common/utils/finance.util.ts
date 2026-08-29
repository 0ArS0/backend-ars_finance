export function sumByDirection<T extends { direction: string; amount: number }>(
  items: T[],
  direction: 'inflow' | 'outflow'
): number {
  return items.filter((item) => item.direction === direction).reduce((sum, item) => sum + item.amount, 0);
}

export function monthlyNeeded(remaining: number, targetDate: Date | null): number {
  if (remaining <= 0) return 0;
  if (!targetDate) return remaining;
  const now = new Date();
  const months = Math.max(
    (targetDate.getUTCFullYear() - now.getUTCFullYear()) * 12 + (targetDate.getUTCMonth() - now.getUTCMonth()),
    1
  );
  return remaining / months;
}

export function futureValue(
  presentValue: number,
  monthlyContribution: number,
  months: number,
  annualReturnRate: number
): number {
  const monthlyRate = annualReturnRate / 12;
  if (monthlyRate === 0) {
    return presentValue + monthlyContribution * months;
  }
  const growth = Math.pow(1 + monthlyRate, months);
  return presentValue * growth + monthlyContribution * ((growth - 1) / monthlyRate);
}

export interface ProjectionEvent {
  date: string;
  amount: number;
  direction: 'inflow' | 'outflow';
  description: string;
}

export interface ProjectionDay {
  date: string;
  balance: number;
  events: ProjectionEvent[];
}

export function buildProjection(
  startBalance: number,
  startDate: Date,
  days: number,
  events: ProjectionEvent[]
): ProjectionDay[] {
  const byDate = new Map<string, ProjectionEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date) ?? [];
    list.push(event);
    byDate.set(event.date, list);
  }

  const result: ProjectionDay[] = [];
  let balance = startBalance;

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + i);
    const dateKey = date.toISOString().slice(0, 10);
    const dayEvents = byDate.get(dateKey) ?? [];

    for (const event of dayEvents) {
      balance += event.direction === 'inflow' ? event.amount : -event.amount;
    }

    result.push({ date: dateKey, balance, events: dayEvents });
  }

  return result;
}

export function safeToSpend(projection: ProjectionDay[], date: string): number {
  const day = projection.find((item) => item.date === date);
  if (!day) return 0;
  return Math.max(day.balance, 0);
}
