import { Module } from '@nestjs/common';
import { RecurringRulesController } from './recurring-rules.controller';
import { RecurringRulesService } from './recurring-rules.service';

@Module({
  controllers: [RecurringRulesController],
  providers: [RecurringRulesService],
  exports: [RecurringRulesService]
})
export class RecurringRulesModule {}
