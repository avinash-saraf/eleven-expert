import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecallModule } from '../recall/recall.module';
import { SessionApiGuard } from './session-api.guard';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [PrismaModule, RecallModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionApiGuard],
  exports: [SessionsService],
})
export class SessionsModule {}
