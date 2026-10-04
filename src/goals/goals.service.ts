import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AllocateGoalDto, CreateGoalDto, CreateGoalLinkDto, SetAllocatedGoalDto, UpdateGoalDto } from './dto/goal.dto';
import { toGoalResponse } from './mappers/goal.mapper';
import { toNumber } from '../common/utils/decimal.util';

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, year?: number, month?: number) {
    const range = this.periodRange(year, month);
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      orderBy: { priority: 'asc' },
      include: {
        links: { orderBy: { createdAt: 'asc' } },
        allocations: { select: { amount: true, allocatedAt: true } }
      }
    });
    return goals.map((goal) => {
      const allocated = goal.allocations.reduce((sum, item) => sum + toNumber(item.amount), 0);
      const allocatedThisPeriod = range
        ? goal.allocations
            .filter((item) => item.allocatedAt >= range.start && item.allocatedAt < range.end)
            .reduce((sum, item) => sum + toNumber(item.amount), 0)
        : allocated;
      return toGoalResponse(goal, allocated, allocatedThisPeriod);
    });
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
    return toGoalResponse(created, 0, 0);
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
    const current = await this.getAllocated(id);
    const next = Math.round((current + dto.amount) * 100) / 100;
    if (next < -0.009) throw new BadRequestException('O alocado não pode ficar negativo');
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

  async setAllocated(userId: string, id: string, dto: SetAllocatedGoalDto) {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundException('Meta não encontrada');
    const current = await this.getAllocated(id);
    const next = Math.round(dto.allocated * 100) / 100;
    const delta = Math.round((next - current) * 100) / 100;
    if (Math.abs(delta) < 0.009) return toGoalResponse(goal, current);

    await this.prisma.goalAllocation.create({
      data: { goalId: id, amount: delta }
    });

    return toGoalResponse(goal, await this.getAllocated(id));
  }

  async getProgress(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new NotFoundException('Meta não encontrada');
    return toGoalResponse(goal, await this.getAllocated(id));
  }

  private periodRange(year?: number, month?: number) {
    if (!year || !month) return null;
    return {
      start: new Date(Date.UTC(year, month - 1, 1)),
      end: new Date(Date.UTC(year, month, 1))
    };
  }

  private async getAllocated(goalId: string) {
    const allocations = await this.prisma.goalAllocation.findMany({ where: { goalId } });
    return allocations.reduce((sum, item) => sum + toNumber(item.amount), 0);
  }
}
