import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CreateSessionDto } from './dto/create-session.dto';
import { SessionApiGuard } from './session-api.guard';
import { SessionsService } from './sessions.service';

@Controller('sessions')
@UseGuards(SessionApiGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  create(
    @Body() body: CreateSessionDto,
    @Headers('idempotency-key') requestKey?: string,
  ) {
    return this.sessions.create(body, requestKey);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.get(id);
  }

  @Post(':id/stop')
  @HttpCode(200)
  stop(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.stop(id);
  }
}
