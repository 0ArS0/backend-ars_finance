import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ProjectionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1095)
  days = 100;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyIncome?: number;
}

export class SafeToSpendQueryDto {
  @IsString()
  date!: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyIncome?: number;
}

export class UpdateProjectionSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyIncome?: number | null;
}
