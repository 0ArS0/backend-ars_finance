import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateImportRuleDto, UpdateImportRuleDto, CommitImportDto, PreviewImportDto } from './dto/import.dto';
import { ImportRulesService } from './import-rules.service';
import { ImportsService } from './imports.service';

@Controller('api/imports')
export class ImportsController {
  constructor(
    private readonly importsService: ImportsService,
    private readonly importRulesService: ImportRulesService
  ) {}

  @Post('preview')
  preview(@Body() body: PreviewImportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.importsService.preview(body, user.id);
  }

  @Post('commit')
  commit(@Body() body: CommitImportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.importsService.commit(body, user.id);
  }

  @Get('rules')
  listRules(@CurrentUser() user: AuthenticatedUser) {
    return this.importRulesService.list(user.id);
  }

  @Post('rules')
  createRule(@Body() body: CreateImportRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.importRulesService.create(user.id, body);
  }

  @Patch('rules/:id')
  updateRule(@Param('id') id: string, @Body() body: UpdateImportRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.importRulesService.update(user.id, id, body);
  }

  @Delete('rules/:id')
  removeRule(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.importRulesService.remove(user.id, id);
  }
}
