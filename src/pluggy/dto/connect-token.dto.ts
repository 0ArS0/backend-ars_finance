import { IsOptional, IsString } from 'class-validator';

export class CreateConnectTokenDto {
  @IsOptional()
  @IsString()
  clientUserId?: string;
}
