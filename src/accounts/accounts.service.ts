import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';
import { toAccountResponse } from './mappers/account.mapper';
import { assertFound } from '../common/utils/prisma.util';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.financialAccount.findMany({ where: { userId }, orderBy: { name: 'asc' } });
    return items.map(toAccountResponse);
  }

  async create(userId: string, dto: CreateAccountDto) {
    const created = await this.prisma.financialAccount.create({ data: { ...dto, userId } });
    return toAccountResponse(created);
  }

  async update(userId: string, id: string, dto: UpdateAccountDto) {
    try {
      const existing = await this.prisma.financialAccount.findFirst({ where: { id, userId } });
      if (!existing) throw new NotFoundException();
      const updated = await this.prisma.financialAccount.update({ where: { id }, data: dto });
      return toAccountResponse(updated);
    } catch {
      throw new NotFoundException('Conta não encontrada');
    }
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.financialAccount.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Conta não encontrada');
    await this.prisma.financialAccount.delete({ where: { id } });
    return { success: true };
  }

  async findById(userId: string, id: string) {
    const account = await this.prisma.financialAccount.findFirst({ where: { id, userId } });
    return assertFound(account, 'Conta não encontrada');
  }
}
