import { Type } from 'class-transformer';
import { ImportMatchType, IncomeKind } from '@prisma/client';
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min, ValidateNested } from 'class-validator';

export class CreateImportRuleDto {
  @IsString()
  label!: string;

  @IsString()
  pattern!: string;

  @IsOptional()
  @IsEnum(ImportMatchType)
  matchType?: ImportMatchType;

  @IsOptional()
  @IsString()
  beneficiaryId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  targetAccountId?: string;

  @IsOptional()
  @IsEnum(IncomeKind)
  incomeKind?: IncomeKind;

  @IsOptional()
  @IsBoolean()
  skip?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpdateImportRuleDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  pattern?: string;

  @IsOptional()
  @IsEnum(ImportMatchType)
  matchType?: ImportMatchType;

  @IsOptional()
  @IsString()
  beneficiaryId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  targetAccountId?: string;

  @IsOptional()
  @IsEnum(IncomeKind)
  incomeKind?: IncomeKind;

  @IsOptional()
  @IsBoolean()
  skip?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PreviewImportDto {
  @IsString()
  accountId!: string;

  @IsString()
  csv!: string;
}

export class CommitImportRowDto {
  @IsString()
  externalId!: string;

  @IsString()
  transactionDate!: string;

  @IsString()
  description!: string;

  @IsIn(['inflow', 'outflow'])
  direction!: 'inflow' | 'outflow';

  @IsString()
  paymentMethod!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  beneficiaryId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  payeeName?: string;

  @IsOptional()
  @IsString()
  targetAccountName?: string;

  @IsOptional()
  @IsEnum(IncomeKind)
  incomeKind?: IncomeKind;

  @IsBoolean()
  selected!: boolean;
}

export class CommitImportDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsNumber()
  periodOpeningBalance?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommitImportRowDto)
  rows!: CommitImportRowDto[];
}
