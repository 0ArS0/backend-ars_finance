import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { BeneficiariesService } from './beneficiaries.service';
import { CreateBeneficiaryDto } from './dto/beneficiary.dto';

@Controller('api/beneficiaries')
export class BeneficiariesController {
  constructor(private readonly beneficiariesService: BeneficiariesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.beneficiariesService.list(user.id);
  }

  @Post()
  create(@Body() body: CreateBeneficiaryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.beneficiariesService.create(user.id, body);
  }
}
