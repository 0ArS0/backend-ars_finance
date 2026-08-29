import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AllocateGoalDto, CreateGoalDto, CreateGoalLinkDto, UpdateGoalDto } from './dto/goal.dto';
import { toGoalResponse } from './mappers/goal.mapper';
import { toNumber } from '../common/utils/decimal.util';

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      orderBy: { priority: 'asc' },
      include: { links: { orderBy: { createdAt: 'asc' } } }
    });
    return Promise.all(goals.map(async (goal) => toGoalResponse(goal, await this.getAllocated(goal.id))));
  }

  async create(userId: string, dto: CreateGoalDto) {
    const created = await this.prisma.goal.create({
      data: {
        name: dto.name,
        targetAmount: dto.targetAmount,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
        priority: dto.priority,
        userId
      }
    });
    return toGoalResponse(created, 0);
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    try {
      const existing = await this.prisma.goal.findFirst({ where: { id, userId } });
      if (!existing) throw new NotFoundException('Meta não encontrada');
      const updated = await this.prisma.goal.update({
        where: { id: existing.id },
        data: {
          ...dto,
          targetDate: dto.targetDate === null ? null : dto.targetDate ? new Date(dto.targetDate) : undefined
        }
      });
      return toGoalResponse(updated, await this.getAllocated(id));
    } catch {
      throw new NotFoundException('Meta não encontrada');
    }
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Meta não encontrada');
    await this.prisma.goal.delete({ where: { id: existing.id } });
    return { success: true };
  }

  async addLink(userId: string, id: string, dto: CreateGoalLinkDto) {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundException('Meta não encontrada');
    return this.prisma.goalLink.create({
      data: {
        goalId: id,
        title: dto.title,
        url: dto.url,
        context: dto.context
      }
    });
  }

  async removeLink(userId: string, id: string, linkId: string) {
    const result = await this.prisma.goalLink.deleteMany({ where: { id: linkId, goal: { id, userId } } });
    if (result.count === 0) throw new NotFoundException('Link não encontrado');
    return { success: true };
  }

  async allocate(userId: string, id: string, dto: AllocateGoalDto) {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundException('Meta não encontrada');
    if (dto.transactionId) {
      const transaction = await this.prisma.transaction.findFirst({
        where: { id: dto.transactionId, account: { userId } },
        select: { id: true }
      });
      if (!transaction) throw new NotFoundException('Transação não encontrada');
    }

    await this.prisma.goalAllocation.create({
      data: { goalId: id, amount: dto.amount, transactionId: dto.transactionId }
    });

    return toGoalResponse(goal, await this.getAllocated(id));
  }

  async getProgress(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundException('Meta não encontrada');
    return toGoalResponse(goal, await this.getAllocated(id));
  }

  private async getAllocated(goalId: string) {
    const allocations = await this.prisma.goalAllocation.findMany({ where: { goalId } });
    return allocations.reduce((sum, item) => sum + toNumber(item.amount), 0);
  }
}
