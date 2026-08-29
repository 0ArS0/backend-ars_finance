import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { AccountsService } from './accounts.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

@Controller('api/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.list(user.id);
  }

  @Post()
  create(@Body() body: CreateAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.create(user.id, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateAccountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.update(user.id, id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.remove(user.id, id);
  }
}
