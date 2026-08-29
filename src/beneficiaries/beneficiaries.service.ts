import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBeneficiaryDto } from './dto/beneficiary.dto';
import { toBeneficiaryResponse } from './mappers/beneficiary.mapper';

@Injectable()
export class BeneficiariesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.beneficiary.findMany({ where: { userId }, orderBy: { name: 'asc' } });
    return items.map(toBeneficiaryResponse);
  }

  async create(userId: string, dto: CreateBeneficiaryDto) {
    const created = await this.prisma.beneficiary.create({ data: { ...dto, userId } });
    return toBeneficiaryResponse(created);
  }
}
