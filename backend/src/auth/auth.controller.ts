import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { DemoLoginDto } from './dto/demo-login.dto';
import { CurrentUser, DemoIdentity, publicIdentity } from './demo-identity';
import { DemoAuthGuard } from './demo-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('demo-login')
  @HttpCode(200)
  login(@Body() dto: DemoLoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(DemoAuthGuard)
  me(@CurrentUser() user: DemoIdentity) {
    return publicIdentity(user);
  }
}
