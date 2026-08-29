import { BudgetType, RecurrenceFrequency, TransactionDirection } from '@prisma/client';
import { IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateRecurringRuleDto {
  @IsString()
  accountId!: string;

  @IsEnum(TransactionDirection)
  direction!: TransactionDirection;

  @IsNumber()
  amount!: number;

  @IsString()
  description!: string;

  @IsEnum(RecurrenceFrequency)
  frequency!: RecurrenceFrequency;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @IsDateString()
  startDate!: string;

  @IsIn([BudgetType.fixed, BudgetType.variable])
  budgetType!: BudgetType;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  beneficiaryId?: string;
}

export class UpdateRecurringRuleDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(RecurrenceFrequency)
  frequency?: RecurrenceFrequency;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsIn([BudgetType.fixed, BudgetType.variable])
  budgetType?: BudgetType;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  beneficiaryId?: string | null;
}
