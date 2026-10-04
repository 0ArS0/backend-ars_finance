import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const UNAVAILABLE_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientRustPanicError) return true;
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return isUnavailableMessage(error.message);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && UNAVAILABLE_CODES.has(error.code)) {
    return true;
  }
  return error instanceof Error && isUnavailableMessage(error.message);
}

function isUnavailableMessage(message: string): boolean {
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|Can't reach database|the provided database server|tenant\/user .* not found|P1001|P1017/i.test(
    message
  );
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new NotFoundException(message);
  }
  return value;
}
