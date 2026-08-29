import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/category.dto';

@Controller('api/categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.categoriesService.list(user.id);
  }

  @Get('tree')
  tree(@CurrentUser() user: AuthenticatedUser) {
    return this.categoriesService.tree(user.id);
  }

  @Post()
  create(@Body() body: CreateCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.categoriesService.create(user.id, body);
  }
}
