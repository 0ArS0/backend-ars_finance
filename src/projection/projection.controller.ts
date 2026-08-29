import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { ProjectionQueryDto, SafeToSpendQueryDto, UpdateProjectionSettingsDto } from './dto/projection.dto';
import { ProjectionService } from './projection.service';

@Controller('api/projection')
export class ProjectionController {
  constructor(private readonly projectionService: ProjectionService) {}

  @Get('suggestions')
  getRecurringSuggestions(@Query('accountId') accountId: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.projectionService.getRecurringSuggestions(user.id, accountId);
  }

  @Get('settings')
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.projectionService.getSettings(user.id);
  }

  @Patch('settings')
  updateSettings(@Body() body: UpdateProjectionSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projectionService.updateSettings(user.id, body);
  }

  @Get()
  getProjection(@Query() query: ProjectionQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projectionService.getProjection(user.id, query);
  }

  @Get('safe-to-spend')
  getSafeToSpend(@Query() query: SafeToSpendQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projectionService.getSafeToSpend(user.id, query);
  }
}
