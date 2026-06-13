import { IsDateString, IsEnum, IsNumber, IsPositive, IsString, MaxLength } from 'class-validator';

export enum TransactionType {
  INCOME = 'income',
  EXPENSE = 'expense'
}

export enum TransactionCategory {
  FIXED = 'fixed',
  VARIABLE = 'variable'
}

export enum TransactionAccount {
  PF = 'pf',
  PJ = 'pj'
}

export class CreateTransactionDto {
  @IsString()
  @MaxLength(120)
  description!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsDateString()
  date!: string;

  @IsEnum(TransactionType)
  type!: TransactionType;

  @IsEnum(TransactionCategory)
  category!: TransactionCategory;

  @IsEnum(TransactionAccount)
  account!: TransactionAccount;
}
