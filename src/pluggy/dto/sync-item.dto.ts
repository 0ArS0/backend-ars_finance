import { LegalContext } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export class PreviewItemDto {
  @IsString()
  itemId!: string;

  @IsOptional()
  @IsEnum(LegalContext)
  legalContext?: LegalContext;
}

export class ImportItemDto extends PreviewItemDto {
  @IsArray()
  @IsString({ each: true })
  selectedAccountIds!: string[];

  @IsArray()
  @IsString({ each: true })
  selectedTransactionIds!: string[];
}
