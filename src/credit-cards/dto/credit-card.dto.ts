import { IsNumber, IsOptional, IsString } from 'class-validator';

export class PayStatementDto {
  @IsString()
  checkingAccountId!: string;

  @IsOptional()
  @IsNumber()
  amount?: number;
}
