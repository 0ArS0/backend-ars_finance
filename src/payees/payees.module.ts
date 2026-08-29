import { Module } from '@nestjs/common';
import { PayeesController } from './payees.controller';
import { PayeesService } from './payees.service';

@Module({
  controllers: [PayeesController],
  providers: [PayeesService],
  exports: [PayeesService]
})
export class PayeesModule {}
