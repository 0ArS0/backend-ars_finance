import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateTransactionDto, ListTransactionsQueryDto, UpdateTransactionDto } from './dto/transaction.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { TransactionsService } from './transactions.service';

@Controller('api/transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  list(@Query() query: ListTransactionsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transactionsService.list(user.id, query);
  }

  @Get('inflows')
  listInflows(@CurrentUser() user: AuthenticatedUser) {
    return this.transactionsService.listInflows(user.id);
  }

  @Get('outflows')
  listOutflows(@CurrentUser() user: AuthenticatedUser) {
    return this.transactionsService.listOutflows(user.id);
  }

  @Post()
  create(@Body() body: CreateTransactionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transactionsService.create(user.id, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateTransactionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transactionsService.update(user.id, id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transactionsService.remove(user.id, id);
  }
}
