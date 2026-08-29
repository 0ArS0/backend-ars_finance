import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const today = new Date();

export class PeriodQueryDto {
  @IsOptional()
  @IsIn(['all', 'pf', 'pj'])
  accountScope: 'all' | 'pf' | 'pj' = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month = today.getMonth() + 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  startMonth = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  endMonth = 12;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year = today.getFullYear();

  @IsOptional()
  @IsIn(['monthly', 'annual'])
  view: 'monthly' | 'annual' = 'monthly';

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsIn(['pf', 'pj'])
  legalContext?: 'pf' | 'pj';
}
