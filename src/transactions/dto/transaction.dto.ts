import {
  IncomeKind,
  PaymentMethod,
  TransactionDirection
} from '@prisma/client';
import { IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { PeriodQueryDto } from '../../common/dto/period-query.dto';

export class CreateTransactionDto {
  @IsString()
  accountId!: string;

  @IsEnum(TransactionDirection)
  direction!: TransactionDirection;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsString()
  @MaxLength(120)
  description!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsDateString()
  transactionDate!: string;

  @IsOptional()
  @IsDateString()
  postedDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(IncomeKind)
  incomeKind?: IncomeKind;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  payeeId?: string;

  @IsOptional()
  @IsString()
  beneficiaryId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  installmentN?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  installmentTotal?: number;
}

export class UpdateTransactionDto {
  @IsOptional()
  @IsEnum(IncomeKind)
  incomeKind?: IncomeKind | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reimbursementOfIds?: string[];
}

export class ListTransactionsQueryDto extends PeriodQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  beneficiaryId?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}
