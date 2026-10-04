import { Module } from '@nestjs/common';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { ImportsModule } from '../imports/imports.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [CreditCardsModule, ImportsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService]
})
export class TransactionsModule {}
