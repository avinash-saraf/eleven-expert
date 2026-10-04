import {
  ConflictException,
  ForbiddenException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../generated/prisma/enums';
import type { Response } from 'express';
import { CurrentUser, DemoIdentity } from '../auth/demo-identity';
import { DemoAuthGuard } from '../auth/demo-auth.guard';
import { JoinMeetingDto } from '../meetings/dto/join-meeting.dto';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { WorkflowsService } from './workflows.service';
import { WorkflowSessionsService } from './workflow-sessions.service';
import { GraphService } from '../learn/graph.service';
import {
  exportInstructionsJson,
  exportInstructionsMarkdown,
} from '../learn/export-instructions';
import { SessionEventsQueryDto } from './dto/session-events-query.dto';

@Controller('workflows')
@UseGuards(DemoAuthGuard)
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly sessions: WorkflowSessionsService,
    private readonly graphs: GraphService,
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

  // Rebuilds the graph from saved knowledge, e.g. after an edit or a failed live build.
  @Post(':workflowId/graph/rebuild')
  @HttpCode(200)
  async rebuildGraph(
    @Param('workflowId', ParseUUIDPipe) id: string,
    @CurrentUser() user: DemoIdentity,
  ) {
    if (user.role !== UserRole.EXPERT)
      throw new ForbiddenException('Only experts can rebuild the graph');
    const workflow = await this.workflows.get(id, user);
    const previous = (workflow.definition as any)?.apprentice?.graph;
    const graph = await this.graphs.build(id, {
      status: previous?.status === 'confirmed' ? 'confirmed' : 'draft',
    });
    if (!graph)
      throw new ConflictException('No saved knowledge to build a graph from');
    return graph;
  }

  // The Work Map as instructions an agent can load. ?format=json returns structured steps.
  @Get(':workflowId/export')
  async exportInstructions(
    @Param('workflowId', ParseUUIDPipe) id: string,
    @Query('format') format: string | undefined,
    @CurrentUser() user: DemoIdentity,
    @Res({ passthrough: true }) res: Response,
  ) {
    const workflow = await this.workflows.get(id, user);
    const result =
      format === 'json'
        ? exportInstructionsJson(workflow.title, workflow.definition)
        : exportInstructionsMarkdown(workflow.title, workflow.definition);
    if (!result)
      throw new ConflictException('This Work Map has no graph to export yet');
    // Expert-supplied text must never be served as HTML.
    if (typeof result === 'string') res.type('text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return result;
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
