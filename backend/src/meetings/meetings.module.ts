import { Module } from '@nestjs/common';
import { RecallModule } from '../recall/recall.module';
import { SessionApiGuard } from '../sessions/session-api.guard';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [RecallModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, SessionApiGuard],
  exports: [MeetingsService],
})
export class MeetingsModule {}
