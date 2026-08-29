import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { AllocateGoalDto, CreateGoalDto, CreateGoalLinkDto, UpdateGoalDto } from './dto/goal.dto';
import { GoalsService } from './goals.service';

@Controller('api/goals')
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.goalsService.list(user.id);
  }

  @Post()
  create(@Body() body: CreateGoalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goalsService.create(user.id, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateGoalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goalsService.update(user.id, id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goalsService.remove(user.id, id);
  }

  @Post(':id/links')
  addLink(@Param('id') id: string, @Body() body: CreateGoalLinkDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goalsService.addLink(user.id, id, body);
  }

  @Delete(':id/links/:linkId')
  removeLink(@Param('id') id: string, @Param('linkId') linkId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goalsService.removeLink(user.id, id, linkId);
  }

  @Post(':id/allocate')
  allocate(@Param('id') id: string, @Body() body: AllocateGoalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.goalsService.allocate(user.id, id, body);
  }

  @Get(':id/progress')
  progress(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goalsService.getProgress(user.id, id);
  }
}
