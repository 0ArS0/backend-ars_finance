import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/category.dto';
import { buildCategoryTree, toCategoryResponse } from './mappers/category.mapper';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.category.findMany({ where: { userId }, orderBy: { name: 'asc' } });
    return items.map(toCategoryResponse);
  }

  async tree(userId: string) {
    const items = await this.prisma.category.findMany({ where: { userId }, orderBy: { name: 'asc' } });
    return buildCategoryTree(items);
  }

  async create(userId: string, dto: CreateCategoryDto) {
    const created = await this.prisma.category.create({ data: { ...dto, userId } });
    return toCategoryResponse(created);
  }
}
