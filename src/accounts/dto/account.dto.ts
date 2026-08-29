import { AccountKind, LegalContext } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  name!: string;

  @IsEnum(AccountKind)
  kind!: AccountKind;

  @IsEnum(LegalContext)
  legalContext!: LegalContext;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsNumber()
  creditLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  closingDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsNumber()
  creditLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  closingDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;
}
