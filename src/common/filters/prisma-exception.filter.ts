import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { isDatabaseUnavailable } from '../utils/prisma.util';

@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientRustPanicError,
  Prisma.PrismaClientInitializationError
)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (isDatabaseUnavailable(exception)) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Banco de dados indisponível. Se o projeto estiver no Supabase, ele pode ter sido pausado.'
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2025') {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Registro não encontrado'
      });
      return;
    }

    console.error('Prisma error:', exception);

    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2021') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'O banco está desatualizado. Aplique as migrations pendentes.'
      });
      return;
    }

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Erro na operação com o banco de dados'
    });
  }
}
