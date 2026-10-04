import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MomentsController } from './moments.controller';
import { MomentsService } from './moments.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [MomentsController],
  providers: [MomentsService],
  exports: [MomentsService],
})
export class MomentsModule {}
