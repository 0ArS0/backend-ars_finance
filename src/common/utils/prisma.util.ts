import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new NotFoundException(message);
  }
  return value;
}
