import { InvestmentTransactionType, LegalContext } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateInvestmentAccountDto {
  @IsString()
  name!: string;

  @IsEnum(LegalContext)
  legalContext!: LegalContext;
}

export class CreateInvestmentTransactionDto {
  @IsString()
  accountId!: string;

  @IsEnum(InvestmentTransactionType)
  type!: InvestmentTransactionType;

  @IsString()
  assetSymbol!: string;

  @IsString()
  assetName!: string;

  @IsNumber()
  quantity!: number;

  @IsNumber()
  unitPrice!: number;

  @IsDateString()
  occurredAt!: string;
}

export class InvestmentProjectionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  months = 60;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyContribution = 0;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  expectedReturn = 0.1;
}
