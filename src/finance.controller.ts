import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { FinanceService } from './finance.service';

@Controller('api')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('dashboard')
  getDashboard(
    @Query('accountScope') accountScope: 'all' | 'pf' | 'pj' = 'all',
    @Query('month', ParseIntPipe) month = 4,
    @Query('year', ParseIntPipe) year = 2026,
    @Query('view') view: 'monthly' | 'annual' = 'monthly'
  ) {
    return this.financeService.getDashboard(accountScope, month, year, view);
  }

  @Get('transactions')
  listTransactions(
    @Query('accountScope') accountScope: 'all' | 'pf' | 'pj' = 'all',
    @Query('month', ParseIntPipe) month = 4,
    @Query('year', ParseIntPipe) year = 2026,
    @Query('view') view: 'monthly' | 'annual' = 'monthly'
  ) {
    return this.financeService.listTransactions(accountScope, month, year, view);
  }

  @Post('transactions')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  createTransaction(@Body() body: CreateTransactionDto) {
    return this.financeService.createTransaction(body);
  }

  @Delete('transactions/:id')
  deleteTransaction(@Param('id') id: string) {
    return this.financeService.deleteTransaction(id);
  }
}
