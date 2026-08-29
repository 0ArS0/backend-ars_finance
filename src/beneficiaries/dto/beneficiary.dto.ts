import { IsString } from 'class-validator';

export class CreateBeneficiaryDto {
  @IsString()
  name!: string;

  @IsString()
  slug!: string;
}
