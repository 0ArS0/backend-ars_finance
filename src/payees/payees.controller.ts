import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { PayeesService } from './payees.service';
import { CreatePayeeDto } from './dto/payee.dto';

@Controller('api/payees')
export class PayeesController {
  constructor(private readonly payeesService: PayeesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.payeesService.list(user.id);
  }

  @Post()
  create(@Body() body: CreatePayeeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payeesService.create(user.id, body);
  }
}
