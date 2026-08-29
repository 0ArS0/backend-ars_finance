import { BudgetType, CategoryKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  name!: string;

  @IsEnum(CategoryKind)
  kind!: CategoryKind;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsEnum(BudgetType)
  budgetType?: BudgetType;
}
