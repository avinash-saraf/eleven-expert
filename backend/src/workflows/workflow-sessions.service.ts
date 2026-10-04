import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DemoIdentity } from '../auth/demo-identity';
import { Session } from '../generated/prisma/client';
import {
  SessionMode,
  SessionStatus,
  UserRole,
} from '../generated/prisma/enums';
import { MeetingsService } from '../meetings/meetings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecallMediaService } from '../recall/media/recall-media.service';
import { RecallService } from '../recall/recall.service';
import { SessionsService } from '../sessions/sessions.service';
import { WorkflowsService } from './workflows.service';
import { LearnService } from '../learn/learn.service';
import { RECALL_OUTPUT_PATH } from '../recall/media/recall-output.page';

@Injectable()
export class WorkflowSessionsService {
  private readonly logger = new Logger(WorkflowSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly meetings: MeetingsService,
    private readonly media: RecallMediaService,
    private readonly recall: RecallService,
    private readonly sessions: SessionsService,
    private readonly learn?: LearnService,
  ) {}

  async create(
    workflowId: string,
    meetingUrl: string,
    user: DemoIdentity,
    requestKey?: string,
  ) {
    const workflow = await this.workflows.get(workflowId, user);
    if (requestKey !== undefined && !/^[\x21-\x7e]{1,128}$/.test(requestKey))
      throw new BadRequestException(
        'Idempotency-Key must contain 1–128 visible ASCII characters',
      );
    const mode =
      user.role === UserRole.EXPERT ? SessionMode.LEARN : SessionMode.TEACH;
    const scopedKey = requestKey
      ? `workflow:${this.hash([user.id, requestKey])}`
      : undefined;
    const fingerprint = this.hash([user.id, workflowId, meetingUrl, mode]);
    if (scopedKey) {
      const existing = await this.prisma.session.findUnique({
        where: { requestKey: scopedKey },
      });
      if (existing) return this.reuse(existing, fingerprint, user, workflowId);
    }
    this.learn?.assertConfigured();
    const stream = this.meetings.prepareStream();
    let session: Session;
    try {
      session = await this.prisma.session.create({
        data: {
          workMapId: workflowId,
          userId: user.id,
          meetingUrl,
          mode,
          mediaStreamId: stream.id,
          requestKey: scopedKey,
          requestFingerprint: fingerprint,
        },
      });
    } catch (error) {
      this.media.discard(stream.id);
      if (scopedKey && error?.code === 'P2002') {
        const existing = await this.prisma.session.findUnique({
          where: { requestKey: scopedKey },
        });
        if (existing)
          return this.reuse(existing, fingerprint, user, workflowId);
      }
      throw error;
    }
    let botId: string;
    try {
      let outputPageUrl: string;
      if (this.learn) {
        this.learn.start({
          sessionId: session.id,
          workflowId,
          streamId: stream.id,
          title: workflow.title,
          definition: workflow.definition,
          mode,
        });
        const url = new URL(stream.websocketUrl);
        url.protocol = 'https:';
        url.pathname = RECALL_OUTPUT_PATH;
        outputPageUrl = url.toString();
      }
      const result = await this.meetings.createBot(
        meetingUrl,
        stream,
        {
          session_id: session.id,
          workflow_id: workflowId,
          mode,
        },
        outputPageUrl,
      );
      botId = result.botId;
    } catch {
      await this.prisma.session.updateMany({
        where: { id: session.id, status: SessionStatus.CREATING },
        data: {
          status: SessionStatus.FAILED,
          error:
            'Recall bot creation failed; inspect Recall before creating another bot',
        },
      });
      throw new BadGatewayException({
        message: 'Recall bot creation failed; inspect Recall before retrying',
        sessionId: session.id,
        streamId: stream.id,
      });
    }
    try {
      await this.prisma.session.updateMany({
        where: { id: session.id, recallBotId: null },
        data: { recallBotId: botId },
      });
      await this.prisma.session.updateMany({
        where: { id: session.id, status: SessionStatus.CREATING },
        data: { status: SessionStatus.JOINING },
      });
    } catch (error) {
      try {
        await this.recall.leaveCall(botId);
      } catch {
        this.logger.error(
          `Could not stop orphaned bot ${botId} for session ${session.id}`,
        );
      }
      await this.learn?.stop(session.id);
      throw error;
    }
    return this.get(workflowId, session.id, user);
  }

  async list(workflowId: string, user: DemoIdentity) {
    await this.workflows.get(workflowId, user);
    const sessions = await this.prisma.session.findMany({
      where: { workMapId: workflowId, userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return sessions.map((session) => this.present(session));
  }

  async get(workflowId: string, id: string, user: DemoIdentity) {
    return this.present(await this.find(workflowId, id, user));
  }

  async stop(workflowId: string, id: string, user: DemoIdentity) {
    await this.find(workflowId, id, user);
    const session = await this.sessions.stop(id);
    await this.learn?.stop(id);
    return this.present(session);
  }

  async apprenticeStatus(workflowId: string, id: string, user: DemoIdentity) {
    await this.find(workflowId, id, user);
    if (!this.learn) throw new NotFoundException('Apprentice unavailable');
    return this.learn.status(id);
  }

  async mediaStatus(workflowId: string, id: string, user: DemoIdentity) {
    const session = await this.find(workflowId, id, user);
    if (!session.mediaStreamId)
      throw new NotFoundException('Media stream not found');
    return this.media.status(session.mediaStreamId);
  }

  async events(
    workflowId: string,
    id: string,
    user: DemoIdentity,
    before?: string,
  ) {
    await this.find(workflowId, id, user);
    const cursor = before
      ? await this.prisma.sessionEvent.findFirst({
          where: { id: before, sessionId: id },
          select: { id: true, createdAt: true },
        })
      : null;
    if (before && !cursor)
      throw new NotFoundException('Session event not found');
    const events = await this.prisma.sessionEvent.findMany({
      where: {
        sessionId: id,
        type: { startsWith: 'apprentice.' },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
      select: {
        id: true,
        type: true,
        payload: true,
        occurredAt: true,
        createdAt: true,
      },
    });
    const page = events.slice(0, 100);
    return {
      items: page.reverse(),
      nextCursor: events.length > 100 ? page[0]?.id : null,
    };
  }

  private async find(workflowId: string, id: string, user: DemoIdentity) {
    const session = await this.prisma.session.findFirst({
      where: {
        id,
        workMapId: workflowId,
        userId: user.id,
        workMap: { organizationId: user.organizationId },
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private reuse(
    session: Session,
    fingerprint: string,
    user: DemoIdentity,
    workflowId: string,
  ) {
    if (
      session.userId !== user.id ||
      session.workMapId !== workflowId ||
      session.requestFingerprint !== fingerprint
    )
      throw new ConflictException(
        'Idempotency-Key was already used for a different session',
      );
    return this.get(workflowId, session.id, user);
  }

  private present(session: Session) {
    return {
      id: session.id,
      workflowId: session.workMapId,
      userId: session.userId,
      meetingUrl: session.meetingUrl,
      mode: session.mode,
      status: session.status,
      botId: session.recallBotId,
      streamId: session.mediaStreamId,
      mediaStatusUrl: session.mediaStreamId
        ? `/workflows/${session.workMapId}/sessions/${session.id}/media`
        : null,
      recallStatus: session.recallStatus,
      error: session.error,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private hash(value: string[]) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
