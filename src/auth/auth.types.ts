import { User } from '@prisma/client';
import { Request } from 'express';

export type AuthenticatedUser = Omit<User, 'passwordHash'>;

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};
