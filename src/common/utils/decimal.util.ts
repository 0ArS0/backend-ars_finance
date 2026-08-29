import { Decimal } from '@prisma/client/runtime/library';

export function toNumber(value: Decimal | number | string): number {
  return Number(value);
}

export function toDecimal(value: number): Decimal {
  return new Decimal(value);
}
