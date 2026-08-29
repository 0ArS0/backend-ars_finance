import { Injectable, NotFoundException } from '@nestjs/common';
import { InvestmentTransactionType } from '@prisma/client';
import { futureValue } from '../common/utils/finance.util';
import { toNumber } from '../common/utils/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateInvestmentAccountDto,
  CreateInvestmentTransactionDto,
  InvestmentProjectionQueryDto
} from './dto/investment.dto';
import {
  toHoldingResponse,
  toInvestmentAccountResponse,
  toInvestmentTransactionResponse
} from './mappers/investment.mapper';

@Injectable()
export class InvestmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAccounts(userId: string) {
    const items = await this.prisma.investmentAccount.findMany({ where: { userId }, orderBy: { name: 'asc' } });
    return items.map(toInvestmentAccountResponse);
  }

  async createAccount(userId: string, dto: CreateInvestmentAccountDto) {
    const created = await this.prisma.investmentAccount.create({ data: { ...dto, userId } });
    return toInvestmentAccountResponse(created);
  }

  async listTransactions(userId: string, accountId?: string) {
    const items = await this.prisma.investmentTransaction.findMany({
      where: accountId ? { accountId, account: { userId } } : { account: { userId } },
      orderBy: { occurredAt: 'desc' }
    });
    return items.map(toInvestmentTransactionResponse);
  }

  async createTransaction(userId: string, dto: CreateInvestmentTransactionDto) {
    const account = await this.prisma.investmentAccount.findFirst({ where: { id: dto.accountId, userId } });
    if (!account) throw new NotFoundException('Conta de investimento não encontrada');

    const totalAmount = dto.quantity * dto.unitPrice;
    const created = await this.prisma.investmentTransaction.create({
      data: {
        accountId: dto.accountId,
        type: dto.type,
        assetSymbol: dto.assetSymbol,
        assetName: dto.assetName,
        quantity: dto.quantity,
        unitPrice: dto.unitPrice,
        totalAmount,
        occurredAt: new Date(dto.occurredAt)
      }
    });

    await this.syncHolding(dto.accountId, dto.assetSymbol, dto.assetName, dto.type, dto.quantity, dto.unitPrice);
    return toInvestmentTransactionResponse(created);
  }

  async getSummary(userId: string) {
    const holdings = await this.prisma.investmentHolding.findMany({ where: { account: { userId } } });
    const items = holdings.map(toHoldingResponse);
    const total = items.reduce((sum, item) => sum + item.currentValue, 0);
    return { total, holdings: items };
  }

  async getProjection(userId: string, query: InvestmentProjectionQueryDto) {
    const summary = await this.getSummary(userId);
    const projected = futureValue(summary.total, query.monthlyContribution, query.months, query.expectedReturn);
    return {
      currentValue: summary.total,
      projectedValue: projected,
      months: query.months,
      monthlyContribution: query.monthlyContribution,
      expectedReturn: query.expectedReturn
    };
  }

  private async syncHolding(
    accountId: string,
    assetSymbol: string,
    assetName: string,
    type: InvestmentTransactionType,
    quantity: number,
    unitPrice: number
  ) {
    const existing = await this.prisma.investmentHolding.findUnique({
      where: { accountId_assetSymbol: { accountId, assetSymbol } }
    });

    if (!existing) {
      if (type === InvestmentTransactionType.sell) return;
      await this.prisma.investmentHolding.create({
        data: { accountId, assetSymbol, assetName, quantity, avgPrice: unitPrice }
      });
      return;
    }

    const currentQty = toNumber(existing.quantity);
    const currentAvg = toNumber(existing.avgPrice);
    let newQty = currentQty;
    let newAvg = currentAvg;

    if (type === InvestmentTransactionType.buy || type === InvestmentTransactionType.contribution) {
      newQty = currentQty + quantity;
      newAvg = (currentQty * currentAvg + quantity * unitPrice) / newQty;
    } else if (type === InvestmentTransactionType.sell) {
      newQty = Math.max(currentQty - quantity, 0);
    }

    if (newQty === 0) {
      await this.prisma.investmentHolding.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.investmentHolding.update({
        where: { id: existing.id },
        data: { quantity: newQty, avgPrice: newAvg, assetName }
      });
    }
  }
}
