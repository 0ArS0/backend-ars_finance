import { Body, Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from './current-user.decorator';
import { Public } from './auth.decorator';
import { AuthenticatedRequest, AuthenticatedUser } from './auth.types';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateProfileDto } from './dto/auth.dto';

const COOKIE_NAME = 'finance_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const COOKIE_SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : '';
const COOKIE_SAME_SITE = process.env.NODE_ENV === 'production' ? 'None' : 'Lax';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    await this.authService.register(dto);
    const auth = await this.authService.login(dto);
    this.setCookie(response, auth.token);
    return { user: auth.user };
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const auth = await this.authService.login(dto);
    this.setCookie(response, auth.token);
    return { user: auth.user };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }

  @Patch('password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }

  @Post('logout')
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.authService.logout(this.readCookie(request.headers.cookie));
    response.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=${COOKIE_SAME_SITE}${COOKIE_SECURE}`
    );
    return { success: true };
  }

  private setCookie(response: Response, token: string) {
    response.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE / 1000}; SameSite=${COOKIE_SAME_SITE}${COOKIE_SECURE}`
    );
  }

  private readCookie(value?: string) {
    return value
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) ?? null;
  }
}
