import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateGoalDto {
  @IsString()
  name!: string;

  @IsNumber()
  targetAmount!: number;

  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @IsOptional()
  @IsInt()
  priority?: number;
}

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  targetAmount?: number;

  @IsOptional()
  @IsDateString()
  targetDate?: string | null;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AllocateGoalDto {
  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  transactionId?: string;
}

export class CreateGoalLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  context?: string;
}
