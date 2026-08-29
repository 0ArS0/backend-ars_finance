import { IsOptional, IsString } from 'class-validator';

export class CreatePayeeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  type?: string;
}
