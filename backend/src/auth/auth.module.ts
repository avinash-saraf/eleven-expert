import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DemoAuthGuard } from './demo-auth.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, DemoAuthGuard],
  exports: [DemoAuthGuard, AuthService],
})
export class AuthModule {}
