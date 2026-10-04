import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { isDatabaseUnavailable } from '../common/utils/prisma.util';
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

    let session;
    try {
      session = await this.prisma.session.findUnique({
        where: { tokenHash: createHash('sha256').update(token).digest('hex') },
        include: { user: true }
      });
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        throw new ServiceUnavailableException(
          'Banco de dados indisponível. Se o projeto estiver no Supabase, ele pode ter sido pausado.'
        );
      }
      throw error;
    }
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
