import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateRecurringRuleDto, UpdateRecurringRuleDto } from './dto/recurring-rule.dto';
import { RecurringRulesService } from './recurring-rules.service';

@Controller('api/recurring-rules')
export class RecurringRulesController {
  constructor(private readonly recurringRulesService: RecurringRulesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.recurringRulesService.list(user.id);
  }

  @Post()
  create(@Body() body: CreateRecurringRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.recurringRulesService.create(user.id, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateRecurringRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.recurringRulesService.update(user.id, id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recurringRulesService.remove(user.id, id);
  }
}
