import { Module } from '@nestjs/common';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';
import { PluggyController } from './pluggy.controller';
import { PluggyService } from './pluggy.service';

@Module({
  imports: [CreditCardsModule],
  controllers: [PluggyController],
  providers: [PluggyService]
})
export class PluggyModule {}
