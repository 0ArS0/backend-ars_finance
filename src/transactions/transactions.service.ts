import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountKind, PaymentMethod } from '@prisma/client';
import { isNotFoundError } from '../common/utils/prisma.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { CreateTransactionDto, ListTransactionsQueryDto, UpdateTransactionDto } from './dto/transaction.dto';
import { buildTransactionWhere, toTransactionResponse } from './mappers/transaction.mapper';

const transactionInclude = {
  account: { select: { id: true, name: true, legalContext: true, kind: true } },
  category: { select: { id: true, name: true, budgetType: true } },
  payee: { select: { id: true, name: true } },
  beneficiary: { select: { id: true, name: true } },
  reimbursementOf: { select: { id: true, description: true, amount: true, transactionDate: true } },
  reimbursementExpenses: {
    include: {
      expense: { select: { id: true, description: true, amount: true, transactionDate: true } }
    }
  }
} as const;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditCardsService: CreditCardsService
  ) {}

  async list(userId: string, query: ListTransactionsQueryDto) {
    const items = await this.prisma.transaction.findMany({
      where: buildTransactionWhere({ ...query, userId }),
      include: transactionInclude,
      orderBy: { transactionDate: 'desc' }
    });
    return items.map(toTransactionResponse);
  }

  async listInflows(userId: string) {
    const items = await this.prisma.transaction.findMany({
      where: { direction: 'inflow', account: { userId } },
      include: transactionInclude,
      orderBy: { transactionDate: 'desc' }
    });
    return items.map(toTransactionResponse);
  }

  async listOutflows(userId: string) {
    const items = await this.prisma.transaction.findMany({
      where: { direction: 'outflow', account: { userId } },
      include: transactionInclude,
      orderBy: { transactionDate: 'desc' }
    });
    return items.map(toTransactionResponse);
  }

  async create(userId: string, dto: CreateTransactionDto) {
    const account = await this.prisma.financialAccount.findFirst({ where: { id: dto.accountId, userId } });
    if (!account) throw new NotFoundException('Conta não encontrada');
    const [category, payee, beneficiary] = await Promise.all([
      dto.categoryId ? this.prisma.category.findFirst({ where: { id: dto.categoryId, userId } }) : null,
      dto.payeeId ? this.prisma.payee.findFirst({ where: { id: dto.payeeId, userId } }) : null,
      dto.beneficiaryId ? this.prisma.beneficiary.findFirst({ where: { id: dto.beneficiaryId, userId } }) : null
    ]);
    if (dto.categoryId && !category) throw new NotFoundException('Categoria não encontrada');
    if (dto.payeeId && !payee) throw new NotFoundException('Favorecido não encontrado');
    if (dto.beneficiaryId && !beneficiary) throw new NotFoundException('Beneficiário não encontrado');

    let statementId: string | undefined;
    if (account.kind === AccountKind.credit_card && dto.paymentMethod === PaymentMethod.credit) {
      const statement = await this.creditCardsService.resolveStatement(
        account.id,
        new Date(dto.transactionDate),
        account.closingDay ?? 1,
        account.dueDay ?? 10
      );
      statementId = statement.id;
    }

    const created = await this.prisma.transaction.create({
      data: {
        accountId: dto.accountId,
        direction: dto.direction,
        paymentMethod: dto.paymentMethod,
        amount: dto.amount,
        description: dto.description,
        notes: dto.notes,
        transactionDate: new Date(dto.transactionDate),
        postedDate: dto.postedDate ? new Date(dto.postedDate) : new Date(dto.transactionDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        incomeKind: dto.incomeKind,
        categoryId: dto.categoryId,
        payeeId: dto.payeeId,
        beneficiaryId: dto.beneficiaryId,
        installmentN: dto.installmentN,
        installmentTotal: dto.installmentTotal,
        statementId
      },
      include: transactionInclude
    });

    if (statementId) {
      await this.creditCardsService.refreshStatementTotal(statementId);
    }

    return toTransactionResponse(created);
  }

  async remove(userId: string, id: string) {
    try {
      const existing = await this.prisma.transaction.findFirst({ where: { id, account: { userId } } });
      if (!existing) throw new NotFoundException('Transação não encontrada');
      await this.prisma.transaction.delete({ where: { id } });
      if (existing?.statementId) {
        await this.creditCardsService.refreshStatementTotal(existing.statementId);
      }
      return { success: true };
    } catch (error) {
      if (isNotFoundError(error)) throw new NotFoundException('Transação não encontrada');
      throw error;
    }
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    const existing = await this.prisma.transaction.findFirst({ where: { id, account: { userId } } });
    if (!existing) throw new NotFoundException('Transação não encontrada');

    const reimbursementOfIds = dto.reimbursementOfIds ?? [];
    if (reimbursementOfIds.length > 0) {
      const expenses = await this.prisma.transaction.findMany({
        where: { id: { in: reimbursementOfIds }, direction: 'outflow', account: { userId } },
        select: { id: true }
      });
      if (expenses.length !== reimbursementOfIds.length) {
        throw new NotFoundException('Despesa relacionada não encontrada');
      }
    }

    const updated = await this.prisma.$transaction(async (prisma) => {
      await prisma.reimbursementExpense.deleteMany({ where: { reimbursementId: id } });
      if (reimbursementOfIds.length > 0) {
        await prisma.reimbursementExpense.createMany({
          data: reimbursementOfIds.map((expenseId) => ({ reimbursementId: id, expenseId }))
        });
      }
      return prisma.transaction.update({
        where: { id },
        data: {
          incomeKind: dto.incomeKind,
          reimbursementOfId: reimbursementOfIds[0] ?? null
        },
        include: transactionInclude
      });
    });

    return toTransactionResponse(updated);
  }
}
