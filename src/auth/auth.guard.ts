import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './auth.decorator';
import { AuthenticatedRequest } from './auth.types';

const SESSION_COOKIE = 'finance_session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.readCookie(request.headers.cookie);
    if (!token) throw new UnauthorizedException('Faça login para continuar');

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      include: { user: true }
    });
    if (!session || session.expiresAt <= new Date()) {
      if (session) await this.prisma.session.delete({ where: { id: session.id } });
      throw new UnauthorizedException('Sessão expirada');
    }

    const { passwordHash: _passwordHash, ...user } = session.user;
    request.user = user;
    return true;
  }

  private readCookie(value?: string) {
    const token = value
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    return token ? decodeURIComponent(token) : null;
  }
}
