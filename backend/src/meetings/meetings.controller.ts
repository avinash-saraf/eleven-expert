import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionApiGuard } from '../sessions/session-api.guard';
import { RecallMediaService } from '../recall/media/recall-media.service';
import { JoinMeetingDto } from './dto/join-meeting.dto';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
@UseGuards(SessionApiGuard)
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly media: RecallMediaService,
  ) {}

  @Post('join')
  join(@Body() body: JoinMeetingDto) {
    return this.meetings.join(body.meetingUrl);
  }

  @Get(':streamId/media')
  status(@Param('streamId', ParseUUIDPipe) streamId: string) {
    return this.media.status(streamId);
  }
}
