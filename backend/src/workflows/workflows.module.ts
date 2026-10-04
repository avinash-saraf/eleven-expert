import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RecallModule } from '../recall/recall.module';
import { SessionsModule } from '../sessions/sessions.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowSessionsService } from './workflow-sessions.service';
import { LearnModule } from '../learn/learn.module';

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    MeetingsModule,
    RecallModule,
    SessionsModule,
    LearnModule,
  ],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowSessionsService],
})
export class WorkflowsModule {}
