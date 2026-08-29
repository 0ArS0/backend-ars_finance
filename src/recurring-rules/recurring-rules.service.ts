import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecurringRuleDto, UpdateRecurringRuleDto } from './dto/recurring-rule.dto';
import { toRecurringRuleResponse } from './mappers/recurring-rule.mapper';

@Injectable()
export class RecurringRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.recurringRule.findMany({
      where: { account: { userId } },
      orderBy: { startDate: 'asc' }
    });
    return items.map(toRecurringRuleResponse);
  }

  async create(userId: string, dto: CreateRecurringRuleDto) {
    const account = await this.prisma.financialAccount.findFirst({ where: { id: dto.accountId, userId } });
    if (!account) throw new NotFoundException('Conta não encontrada');
    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({ where: { id: dto.categoryId, userId } });
      if (!category) throw new NotFoundException('Categoria não encontrada');
    }
    if (dto.beneficiaryId) {
      const beneficiary = await this.prisma.beneficiary.findFirst({ where: { id: dto.beneficiaryId, userId } });
      if (!beneficiary) throw new NotFoundException('Beneficiário não encontrado');
    }
    const created = await this.prisma.recurringRule.create({
      data: {
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined
      }
    });
    return toRecurringRuleResponse(created);
  }

  async update(userId: string, id: string, dto: UpdateRecurringRuleDto) {
    try {
      const existing = await this.prisma.recurringRule.findFirst({ where: { id, account: { userId } } });
      if (!existing) throw new NotFoundException('Recorrência não encontrada');
      if (dto.accountId) {
        const account = await this.prisma.financialAccount.findFirst({ where: { id: dto.accountId, userId } });
        if (!account) throw new NotFoundException('Conta não encontrada');
      }
      if (dto.categoryId) {
        const category = await this.prisma.category.findFirst({ where: { id: dto.categoryId, userId } });
        if (!category) throw new NotFoundException('Categoria não encontrada');
      }
      if (dto.beneficiaryId) {
        const beneficiary = await this.prisma.beneficiary.findFirst({ where: { id: dto.beneficiaryId, userId } });
        if (!beneficiary) throw new NotFoundException('Beneficiário não encontrado');
      }
      const updated = await this.prisma.recurringRule.update({
        where: { id: existing.id },
        data: {
          ...dto,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate === null ? null : dto.endDate ? new Date(dto.endDate) : undefined
        }
      });
      return toRecurringRuleResponse(updated);
    } catch {
      throw new NotFoundException('Recorrência não encontrada');
    }
  }

  async remove(userId: string, id: string) {
    try {
      const existing = await this.prisma.recurringRule.findFirst({ where: { id, account: { userId } } });
      if (!existing) throw new NotFoundException('Recorrência não encontrada');
      await this.prisma.recurringRule.delete({ where: { id: existing.id } });
      return { success: true };
    } catch {
      throw new NotFoundException('Recorrência não encontrada');
    }
  }
}
