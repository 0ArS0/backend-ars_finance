import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Transaction as PrismaTransaction } from '@prisma/client';
import {
  CreateTransactionDto,
  TransactionAccount,
  TransactionCategory,
  TransactionType
} from './dto/create-transaction.dto';
import { PrismaService } from './prisma/prisma.service';

export interface Transaction extends CreateTransactionDto {
  id: string;
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async listTransactions(accountScope: 'all' | 'pf' | 'pj', month: number, year: number, view: 'monthly' | 'annual') {
    const items = await this.prisma.transaction.findMany({
      where: this.buildWhere(accountScope, month, year, view),
      orderBy: { date: 'desc' }
    });

    return items.map((item) => this.toTransaction(item));
  }

  async createTransaction(dto: CreateTransactionDto) {
    const created = await this.prisma.transaction.create({
      data: {
        description: dto.description,
        amount: dto.amount,
        date: new Date(dto.date),
        type: dto.type,
        category: dto.category,
        account: dto.account
      }
    });

    return this.toTransaction(created);
  }

  async deleteTransaction(id: string) {
    try {
      await this.prisma.transaction.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Transação não encontrada');
      }
      throw error;
    }
  }

  async getDashboard(accountScope: 'all' | 'pf' | 'pj', month: number, year: number, view: 'monthly' | 'annual') {
    const filtered = await this.prisma.transaction.findMany({
      where: this.buildWhere(accountScope, month, year, view)
    });
    const mapped = filtered.map((item) => this.toTransaction(item));

    const receitas = mapped.filter((item) => item.type === TransactionType.INCOME).reduce((sum, item) => sum + item.amount, 0);
    const despesas = mapped.filter((item) => item.type === TransactionType.EXPENSE).reduce((sum, item) => sum + item.amount, 0);
    const fixo = mapped.filter((item) => item.type === TransactionType.EXPENSE && item.category === TransactionCategory.FIXED).reduce((sum, item) => sum + item.amount, 0);
    const variavel = mapped.filter((item) => item.type === TransactionType.EXPENSE && item.category === TransactionCategory.VARIABLE).reduce((sum, item) => sum + item.amount, 0);

    const yearTransactions = await this.prisma.transaction.findMany({
      where: {
        date: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lte: new Date(Date.UTC(year, 11, 31))
        },
        ...(accountScope !== 'all' ? { account: accountScope } : {})
      }
    });

    const monthlySeries = Array.from({ length: 12 }, (_, index) => {
      const monthIndex = index + 1;
      const monthTransactions = yearTransactions.filter((item) => {
        const date = new Date(item.date);
        return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === monthIndex;
      });

      return {
        month: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][index],
        receitas: monthTransactions.filter((item) => item.type === TransactionType.INCOME).reduce((sum, item) => sum + Number(item.amount), 0),
        despesas: monthTransactions.filter((item) => item.type === TransactionType.EXPENSE).reduce((sum, item) => sum + Number(item.amount), 0)
      };
    });

    return {
      summary: {
        receitas,
        despesas,
        saldo: receitas - despesas,
        fixo,
        variavel
      },
      monthlySeries
    };
  }

  private buildWhere(accountScope: 'all' | 'pf' | 'pj', month: number, year: number, view: 'monthly' | 'annual'): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = {
      date: {
        gte: new Date(Date.UTC(year, view === 'monthly' ? month - 1 : 0, 1)),
        lte: view === 'monthly'
          ? new Date(Date.UTC(year, month, 0))
          : new Date(Date.UTC(year, 11, 31))
      }
    };

    if (accountScope !== 'all') {
      where.account = accountScope;
    }

    return where;
  }

  private toTransaction(record: PrismaTransaction): Transaction {
    return {
      id: record.id,
      description: record.description,
      amount: Number(record.amount),
      date: record.date.toISOString().slice(0, 10),
      type: record.type as TransactionType,
      category: record.category as TransactionCategory,
      account: record.account as TransactionAccount
    };
  }
}
