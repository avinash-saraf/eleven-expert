import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SessionMode, SessionStatus } from '../generated/prisma/enums';
import { Prisma, Session } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecallService } from '../recall/recall.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { createHash } from 'node:crypto';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recall: RecallService,
  ) {}

  async create(dto: CreateSessionDto, requestKey?: string) {
    if (requestKey !== undefined && !/^[\x21-\x7e]{1,128}$/.test(requestKey)) {
      throw new BadRequestException(
        'Idempotency-Key must contain 1–128 visible ASCII characters',
      );
    }
    if (dto.mode === SessionMode.TEACH && !dto.workMapId) {
      throw new BadRequestException('TEACH sessions require workMapId');
    }
    if (dto.mode === SessionMode.TEACH && dto.title !== undefined) {
      throw new BadRequestException(
        'title is only supported for LEARN sessions',
      );
    }
    if (requestKey) {
      const existing = await this.prisma.session.findUnique({
        where: { requestKey },
      });
      if (existing) return this.reuse(existing, dto);
    }
    this.recall.assertConfigured();
    if (dto.workMapId) {
      const map = await this.prisma.workMap.findUnique({
        where: { id: dto.workMapId },
      });
      if (!map) throw new NotFoundException('Work Map not found');
    }

    let session: Session;
    try {
      session = await this.prisma.session.create({
        data: {
          meetingUrl: dto.meetingUrl,
          mode: dto.mode,
          requestKey,
          requestFingerprint: requestKey ? this.fingerprint(dto) : undefined,
          workMap: dto.workMapId
            ? { connect: { id: dto.workMapId } }
            : { create: { title: dto.title ?? 'Untitled workflow' } },
        },
      });
    } catch (error) {
      if (requestKey && this.isUniqueConflict(error)) {
        const existing = await this.prisma.session.findUnique({
          where: { requestKey },
        });
        if (existing) return this.reuse(existing, dto);
      }
      throw error;
    }

    let botId: string;
    try {
      botId = (await this.recall.createBot(session)).id;
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
        message: 'Recall could not create the bot',
        sessionId: session.id,
      });
    }

    try {
      // An early webhook may have already advanced this session.
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
          `Could not stop orphaned Recall bot ${botId} for session ${session.id}`,
        );
      }
      throw error;
    }
    return this.get(session.id);
  }

  async get(id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { workMap: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async stop(id: string) {
    const session = await this.get(id);
    const stopped: SessionStatus[] = [
      SessionStatus.ENDED,
      SessionStatus.COMPLETED,
      SessionStatus.FAILED,
      SessionStatus.STOPPING,
    ];
    if (stopped.includes(session.status)) {
      return session;
    }
    if (!session.recallBotId) {
      throw new ConflictException('Bot creation is still in progress');
    }
    const stopRequestedAt = new Date();
    const claimed = await this.prisma.session.updateMany({
      where: { id, status: session.status },
      data: { status: SessionStatus.STOPPING, stopRequestedAt },
    });
    if (!claimed.count) return this.get(id);

    try {
      await this.recall.leaveCall(session.recallBotId);
    } catch (error) {
      await this.prisma.session.updateMany({
        where: { id, status: SessionStatus.STOPPING, stopRequestedAt },
        data: { status: session.status, stopRequestedAt: null },
      });
      throw error;
    }
    // The webhook, rather than the leave request, confirms that the call ended.
    return this.get(id);
  }

  private reuse(session: Session, dto: CreateSessionDto) {
    if (session.requestFingerprint !== this.fingerprint(dto)) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different session',
      );
    }
    return this.get(session.id);
  }

  private isUniqueConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private fingerprint(dto: CreateSessionDto) {
    return createHash('sha256')
      .update(
        JSON.stringify([
          dto.meetingUrl,
          dto.mode,
          dto.workMapId ?? null,
          dto.title ?? null,
        ]),
      )
      .digest('hex');
  }
}
