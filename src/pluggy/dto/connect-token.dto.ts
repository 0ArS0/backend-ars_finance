import { LegalContext } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateConnectTokenDto {
  @IsOptional()
  @IsString()
  clientUserId?: string;

  @IsOptional()
  @IsString()
  itemId?: string;
}

export class LinkPluggyConnectionDto {
  @IsString()
  itemId!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsEnum(LegalContext)
  legalContext?: LegalContext;
}
