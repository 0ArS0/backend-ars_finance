import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreditCardsService } from './credit-cards.service';
import { PayStatementDto } from './dto/credit-card.dto';

@Controller('api/credit-cards')
export class CreditCardsController {
  constructor(private readonly creditCardsService: CreditCardsService) {}

  @Get(':accountId/statements')
  listStatements(@Param('accountId') accountId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.creditCardsService.listStatements(user.id, accountId);
  }

  @Get(':accountId/available-limit')
  getAvailableLimit(@Param('accountId') accountId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.creditCardsService.getAvailableLimit(user.id, accountId);
  }

  @Get('statements/:id/transactions')
  getStatementTransactions(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.creditCardsService.getStatementTransactions(user.id, id);
  }

  @Post('statements/:id/pay')
  payStatement(@Param('id') id: string, @Body() body: PayStatementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.creditCardsService.payStatement(user.id, id, body);
  }
}
