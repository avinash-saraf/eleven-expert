import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, DemoIdentity } from '../auth/demo-identity';
import { DemoAuthGuard } from '../auth/demo-auth.guard';
import { JoinMeetingDto } from '../meetings/dto/join-meeting.dto';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { WorkflowsService } from './workflows.service';
import { WorkflowSessionsService } from './workflow-sessions.service';
import { SessionEventsQueryDto } from './dto/session-events-query.dto';

@Controller('workflows')
@UseGuards(DemoAuthGuard)
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly sessions: WorkflowSessionsService,
  ) {}

  @Post()
  create(@Body() dto: CreateWorkflowDto, @CurrentUser() user: DemoIdentity) {
    return this.workflows.create(dto, user);
  }

  @Get()
  list(@CurrentUser() user: DemoIdentity) {
    return this.workflows.list(user);
  }

  @Get(':workflowId')
  get(
    @Param('workflowId', ParseUUIDPipe) id: string,
    @CurrentUser() user: DemoIdentity,
  ) {
    return this.workflows.get(id, user);
  }

  @Post(':workflowId/sessions')
  createSession(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Body() dto: JoinMeetingDto,
    @CurrentUser() user: DemoIdentity,
    @Headers('idempotency-key') requestKey?: string,
  ) {
    return this.sessions.create(workflowId, dto.meetingUrl, user, requestKey);
  }

  @Get(':workflowId/sessions')
  listSessions(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @CurrentUser() user: DemoIdentity,
  ) {
    return this.sessions.list(workflowId, user);
  }

  @Get(':workflowId/sessions/:sessionId')
  getSession(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: DemoIdentity,
  ) {
    return this.sessions.get(workflowId, sessionId, user);
  }

  @Post(':workflowId/sessions/:sessionId/stop')
  @HttpCode(200)
  stopSession(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: DemoIdentity,
  ) {
    return this.sessions.stop(workflowId, sessionId, user);
  }

  @Get(':workflowId/sessions/:sessionId/media')
  mediaStatus(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: DemoIdentity,
  ) {
    return this.sessions.mediaStatus(workflowId, sessionId, user);
  }

  @Get(':workflowId/sessions/:sessionId/apprentice')
  apprenticeStatus(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: DemoIdentity,
  ) {
    return this.sessions.apprenticeStatus(workflowId, sessionId, user);
  }

  @Get(':workflowId/sessions/:sessionId/events')
  events(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query() query: SessionEventsQueryDto,
    @CurrentUser() user: DemoIdentity,
  ) {
    return this.sessions.events(workflowId, sessionId, user, query.before);
  }
}
