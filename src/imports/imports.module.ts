import { Module } from '@nestjs/common';
import { ImportRulesService } from './import-rules.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  controllers: [ImportsController],
  providers: [ImportsService, ImportRulesService],
  exports: [ImportRulesService]
})
export class ImportsModule {}
