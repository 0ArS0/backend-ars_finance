import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePayeeDto } from './dto/payee.dto';
import { toPayeeResponse } from './mappers/payee.mapper';

@Injectable()
export class PayeesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.payee.findMany({ where: { userId }, orderBy: { name: 'asc' } });
    return items.map(toPayeeResponse);
  }

  async create(userId: string, dto: CreatePayeeDto) {
    const created = await this.prisma.payee.create({ data: { ...dto, userId } });
    return toPayeeResponse(created);
  }
}
