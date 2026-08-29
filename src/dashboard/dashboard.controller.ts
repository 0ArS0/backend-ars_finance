import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { PeriodQueryDto } from '../common/dto/period-query.dto';
import { DashboardService } from './dashboard.service';

@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(@Query() query: PeriodQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dashboardService.getDashboard(query, user.id);
  }
}
