import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateInvestmentAccountDto,
  CreateInvestmentTransactionDto,
  InvestmentProjectionQueryDto
} from './dto/investment.dto';
import { InvestmentsService } from './investments.service';

@Controller('api/investments')
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Get('accounts')
  listAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.investmentsService.listAccounts(user.id);
  }

  @Post('accounts')
  createAccount(@Body() body: CreateInvestmentAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.investmentsService.createAccount(user.id, body);
  }

  @Get('transactions')
  listTransactions(@Query('accountId') accountId: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.investmentsService.listTransactions(user.id, accountId);
  }

  @Post('transactions')
  createTransaction(@Body() body: CreateInvestmentTransactionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.investmentsService.createTransaction(user.id, body);
  }

  @Get('summary')
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.investmentsService.getSummary(user.id);
  }

  @Get('projection')
  getProjection(@Query() query: InvestmentProjectionQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.investmentsService.getProjection(user.id, query);
  }
}
