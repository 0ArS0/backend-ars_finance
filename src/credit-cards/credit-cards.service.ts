import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountKind, PaymentMethod, TransactionDirection } from '@prisma/client';
import {
  resolveStatementReferenceMonth,
  statementClosingDate,
  statementDueDate,
  toDateOnlyString
} from '../common/utils/date.util';
import { toNumber } from '../common/utils/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import { PayStatementDto } from './dto/credit-card.dto';
import { toStatementResponse } from './mappers/credit-card.mapper';
import { CreditCardBills } from 'pluggy-sdk';

@Injectable()
export class CreditCardsService {
  private readonly statementSyncs = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  async resolveStatement(accountId: string, transactionDate: Date, closingDay: number, dueDay: number) {
    const referenceMonth = resolveStatementReferenceMonth(transactionDate, closingDay);
    const existing = await this.prisma.creditCardStatement.findFirst({
      where: { accountId, referenceMonth }
    });

    if (existing) return existing;

    return this.prisma.creditCardStatement.create({
      data: {
        accountId,
        referenceMonth,
        closingDate: statementClosingDate(referenceMonth, closingDay),
        dueDate: statementDueDate(referenceMonth, dueDay)
      }
    });
  }

  async refreshStatementTotal(statementId: string) {
    const statement = await this.prisma.creditCardStatement.findUnique({
      where: { id: statementId },
      select: { isExternalTotal: true }
    });
    if (!statement || statement.isExternalTotal) return;

    const transactions = await this.prisma.transaction.findMany({ where: { statementId } });
    const total = transactions.reduce((sum, item) => sum + toNumber(item.amount), 0);
    await this.prisma.creditCardStatement.update({
      where: { id: statementId },
      data: { totalAmount: total }
    });
  }

  async syncExternalBills(accountId: string, bills: CreditCardBills[]) {
    const account = await this.prisma.financialAccount.findUnique({
      where: { id: accountId },
      select: { closingDay: true, dueDay: true }
    });
    if (!account) return;

    const closingDay = account.closingDay ?? 3;
    const dueDay = account.dueDay ?? 10;
    for (const bill of bills) {
      const dueDate = new Date(bill.dueDate);
      const referenceMonth = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() - 1, 1));
      const existing = await this.prisma.creditCardStatement.findFirst({
        where: { accountId, referenceMonth }
      });
      const paidAmount = bill.payments.reduce((sum, payment) => sum + payment.amount, 0);
      const data = {
        totalAmount: bill.totalAmount,
        paidAmount,
        isExternalTotal: true,
        isPaid: paidAmount >= bill.totalAmount,
        closingDate: statementClosingDate(referenceMonth, closingDay),
        dueDate: new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()))
      };

      if (existing) {
        await this.prisma.creditCardStatement.update({ where: { id: existing.id }, data });
      } else {
        await this.prisma.creditCardStatement.create({
          data: {
            accountId,
            referenceMonth,
            ...data
          }
        });
      }
    }
  }

  async listStatements(userId: string, accountId: string) {
    await this.assertAccountOwner(userId, accountId);
    await this.ensureStatements(accountId);
    const items = await this.prisma.creditCardStatement.findMany({
      where: { accountId },
      orderBy: { referenceMonth: 'desc' }
    });
    return items.map(toStatementResponse);
  }

  async getAvailableLimit(userId: string, accountId: string) {
    const account = await this.prisma.financialAccount.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Conta não encontrada');

    await this.ensureStatements(accountId);
    const openStatements = await this.prisma.creditCardStatement.findMany({
      where: { accountId, isPaid: false }
    });
    const used = openStatements.reduce((sum, item) => sum + toNumber(item.totalAmount) - toNumber(item.paidAmount), 0);
    const limit = account.creditLimit ? toNumber(account.creditLimit) : 0;

    return { creditLimit: limit, used, available: Math.max(limit - used, 0) };
  }

  async payStatement(userId: string, statementId: string, dto: PayStatementDto) {
    const statement = await this.prisma.creditCardStatement.findFirst({
      where: { id: statementId, account: { userId } }
    });
    if (!statement) throw new NotFoundException('Fatura não encontrada');

    const amount = dto.amount ?? toNumber(statement.totalAmount) - toNumber(statement.paidAmount);
    const checkingAccount = await this.prisma.financialAccount.findFirst({
      where: { id: dto.checkingAccountId, userId }
    });
    if (!checkingAccount) throw new NotFoundException('Conta não encontrada');

    await this.prisma.transaction.create({
      data: {
        accountId: dto.checkingAccountId,
        direction: TransactionDirection.outflow,
        paymentMethod: PaymentMethod.transfer,
        amount,
        description: `Pagamento fatura cartão`,
        transactionDate: new Date(),
        postedDate: new Date(),
        dueDate: statement.dueDate
      }
    });

    const updated = await this.prisma.creditCardStatement.update({
      where: { id: statementId },
      data: {
        paidAmount: toNumber(statement.paidAmount) + amount,
        isPaid: toNumber(statement.totalAmount) <= toNumber(statement.paidAmount) + amount
      }
    });

    return toStatementResponse(updated);
  }

  async getStatementTransactions(userId: string, statementId: string) {
    const statement = await this.prisma.creditCardStatement.findFirst({
      where: { id: statementId, account: { userId } },
      select: { id: true }
    });
    if (!statement) throw new NotFoundException('Fatura não encontrada');
    const items = await this.prisma.transaction.findMany({
      where: { statementId },
      include: {
        payee: { select: { id: true, name: true } },
        beneficiary: { select: { id: true, name: true } }
      },
      orderBy: { transactionDate: 'desc' }
    });

    return items.map((item) => ({
      id: item.id,
      description: item.description,
      amount: toNumber(item.amount),
      transactionDate: toDateOnlyString(item.transactionDate),
      payee: item.payee,
      beneficiary: item.beneficiary
    }));
  }

  private async assertAccountOwner(userId: string, accountId: string) {
    const account = await this.prisma.financialAccount.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Cartão não encontrado');
  }

  private async ensureStatements(accountId: string) {
    const pending = this.statementSyncs.get(accountId);
    if (pending) return pending;

    let operation: Promise<void>;
    operation = this.reconcileStatements(accountId).finally(() => {
      if (this.statementSyncs.get(accountId) === operation) {
        this.statementSyncs.delete(accountId);
      }
    });
    this.statementSyncs.set(accountId, operation);
    return operation;
  }

  private async reconcileStatements(accountId: string) {
    const account = await this.prisma.financialAccount.findUnique({
      where: { id: accountId },
      select: { kind: true, closingDay: true, dueDay: true }
    });
    if (!account || account.kind !== AccountKind.credit_card) return;

    const closingDay = account.closingDay ?? 3;
    const dueDay = account.dueDay ?? 10;
    if (account.closingDay === null || account.dueDay === null) {
      await this.prisma.financialAccount.update({
        where: { id: accountId },
        data: { closingDay, dueDay }
      });
    }
    const statements = await this.prisma.creditCardStatement.findMany({
      where: { accountId },
      select: { id: true, referenceMonth: true }
    });
    for (const statement of statements) {
      await this.prisma.creditCardStatement.update({
        where: { id: statement.id },
        data: {
          closingDate: statementClosingDate(statement.referenceMonth, closingDay),
          dueDate: statementDueDate(statement.referenceMonth, dueDay)
        }
      });
    }

    await this.mergeDuplicateStatements(accountId);

    const transactions = await this.prisma.transaction.findMany({
      where: {
        accountId
      },
      select: {
        id: true,
        description: true,
        notes: true,
        direction: true,
        transactionDate: true,
        statementId: true
      }
    });
    for (const transaction of transactions) {
      if (this.isCardPayment(transaction.description, transaction.notes)) {
        await this.prisma.transaction.delete({ where: { id: transaction.id } });
        continue;
      }

      const statement = await this.resolveStatement(
        accountId,
        transaction.transactionDate,
        closingDay,
        dueDay
      );
      if (transaction.statementId !== statement.id) {
        await this.prisma.transaction.update({
          where: { id: transaction.id },
          data: { statementId: statement.id }
        });
      }
    }

    const allStatementIds = await this.prisma.creditCardStatement.findMany({
      where: { accountId },
      select: { id: true }
    });
    for (const statementId of allStatementIds.map((statement) => statement.id)) {
      await this.refreshStatementTotal(statementId);
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const overdueStatements = await this.prisma.creditCardStatement.findMany({
      where: {
        accountId,
        dueDate: { lt: today }
      },
      select: { id: true, totalAmount: true }
    });
    for (const statement of overdueStatements) {
      await this.prisma.creditCardStatement.update({
        where: { id: statement.id },
        data: { isPaid: true, paidAmount: statement.totalAmount }
      });
    }
  }

  private async mergeDuplicateStatements(accountId: string) {
    const statements = await this.prisma.creditCardStatement.findMany({
      where: { accountId },
      orderBy: { totalAmount: 'desc' }
    });
    const grouped = new Map<string, typeof statements>();

    for (const statement of statements) {
      const key = statement.referenceMonth.toISOString().slice(0, 10);
      const group = grouped.get(key) ?? [];
      group.push(statement);
      grouped.set(key, group);
    }

    for (const group of grouped.values()) {
      if (group.length < 2) continue;

      const [keeper, ...duplicates] = group;
      for (const duplicate of duplicates) {
        await this.prisma.transaction.updateMany({
          where: { statementId: duplicate.id },
          data: { statementId: keeper.id }
        });
        await this.prisma.creditCardStatement.delete({ where: { id: duplicate.id } });
      }
      await this.refreshStatementTotal(keeper.id);
      if (keeper.isPaid || duplicates.some((statement) => statement.isPaid)) {
        const refreshed = await this.prisma.creditCardStatement.findUniqueOrThrow({
          where: { id: keeper.id },
          select: { totalAmount: true }
        });
        await this.prisma.creditCardStatement.update({
          where: { id: keeper.id },
          data: { isPaid: true, paidAmount: refreshed.totalAmount }
        });
      }
    }
  }

  private isCardPayment(description: string, notes: string | null) {
    const text = `${description} ${notes ?? ''}`
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    return /pagamento recebido|pagamento.*fatura|pagamento.*cartao|credit card payment|payment received/.test(text);
  }
}
