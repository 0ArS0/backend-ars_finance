export const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;

export type YearMonth = { year: number; month: number };

export function yearMonthFromDate(date: Date): YearMonth {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

export function monthRangeUTC(year: number, month: number) {
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lte: new Date(Date.UTC(year, month, 0))
  };
}

export function yearRangeUTC(year: number) {
  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lte: new Date(Date.UTC(year, 11, 31))
  };
}

export function periodRangeUTC(
  year: number,
  month: number,
  view: 'monthly' | 'annual',
  startMonth = 1,
  endMonth = 12
) {
  if (view === 'monthly') return monthRangeUTC(year, month);
  return {
    gte: new Date(Date.UTC(year, startMonth - 1, 1)),
    lte: new Date(Date.UTC(year, endMonth, 0))
  };
}

export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateOnly(value: string): Date {
  return new Date(value);
}

export function getUTCMonth(date: Date): number {
  return date.getUTCMonth() + 1;
}

export function getUTCYear(date: Date): number {
  return date.getUTCFullYear();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function resolveStatementReferenceMonth(transactionDate: Date, closingDay: number): Date {
  const day = transactionDate.getUTCDate();
  const month = transactionDate.getUTCMonth();
  const year = transactionDate.getUTCFullYear();
  if (day <= closingDay) {
    return new Date(Date.UTC(year, month - 1, 1));
  }
  return new Date(Date.UTC(year, month, 1));
}

export function statementClosingDate(referenceMonth: Date, closingDay: number): Date {
  return new Date(Date.UTC(referenceMonth.getUTCFullYear(), referenceMonth.getUTCMonth() + 1, closingDay));
}

export function statementDueDate(referenceMonth: Date, dueDay: number): Date {
  return new Date(Date.UTC(referenceMonth.getUTCFullYear(), referenceMonth.getUTCMonth() + 1, dueDay));
}

export function monthsBetween(from: Date, to: Date): number {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return Math.max(months, 1);
}

export function expandRecurringDates(
  startDate: Date,
  endDate: Date | null,
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly',
  dayOfMonth: number | null,
  horizonEnd: Date
): Date[] {
  const dates: Date[] = [];
  let current = new Date(startDate);
  const limit = endDate && endDate < horizonEnd ? endDate : horizonEnd;

  while (current <= limit) {
    dates.push(new Date(current));
    if (frequency === 'daily') {
      current = addDays(current, 1);
    } else if (frequency === 'weekly') {
      current = addDays(current, 7);
    } else if (frequency === 'monthly') {
      const nextMonth = current.getUTCMonth() + 1;
      const day = dayOfMonth ?? current.getUTCDate();
      current = new Date(Date.UTC(current.getUTCFullYear(), nextMonth, day));
    } else {
      current = new Date(Date.UTC(current.getUTCFullYear() + 1, current.getUTCMonth(), current.getUTCDate()));
    }
  }

  return dates;
}
