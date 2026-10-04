import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecallService } from '../recall/recall.service';
import { SessionMode, SessionStatus } from '../generated/prisma/enums';
import { SessionsService } from './sessions.service';

describe('Session workflow', () => {
  const dto = {
    mode: SessionMode.LEARN,
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
  };
  let prisma: any;
  let recall: any;
  let service: SessionsService;
  let session: any;

  beforeEach(() => {
    session = {
      id: 'session-1',
      ...dto,
      status: SessionStatus.CREATING,
      recallBotId: null,
      workMapId: 'map-1',
    };
    prisma = {
      session: {
        create: jest.fn(async ({ data }) => {
          Object.assign(session, {
            requestKey: data.requestKey,
            requestFingerprint: data.requestFingerprint,
          });
          return { ...session };
        }),
        findUnique: jest.fn(async () => ({ ...session })),
        updateMany: jest.fn(async ({ where, data }) => {
          if (where.status && where.status !== session.status)
            return { count: 0 };
          if (where.recallBotId === null && session.recallBotId !== null)
            return { count: 0 };
          Object.assign(session, data);
          return { count: 1 };
        }),
      },
      workMap: { findUnique: jest.fn().mockResolvedValue({ id: 'map-1' }) },
    };
    recall = {
      assertConfigured: jest.fn(),
      createBot: jest.fn().mockResolvedValue({ id: 'bot-1' }),
      leaveCall: jest.fn().mockResolvedValue(undefined),
    };
    service = new SessionsService(
      prisma as PrismaService,
      recall as RecallService,
    );
  });

  it('creates a Learn session and its Work Map, then attaches the bot', async () => {
    await expect(service.create(dto)).resolves.toMatchObject({
      recallBotId: 'bot-1',
      status: SessionStatus.JOINING,
    });
    expect(prisma.session.create.mock.calls[0][0].data.workMap).toEqual({
      create: { title: 'Untitled workflow' },
    });
  });

  it('requires an existing Work Map for Teach sessions', async () => {
    await expect(
      service.create({ ...dto, mode: SessionMode.TEACH }),
    ).rejects.toThrow(BadRequestException);
    prisma.workMap.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ ...dto, mode: SessionMode.TEACH, workMapId: 'missing' }),
    ).rejects.toThrow(NotFoundException);
    expect(recall.createBot).not.toHaveBeenCalled();
  });

  it('persists failed creation without retrying or exposing upstream details', async () => {
    recall.createBot.mockRejectedValue(new Error('private API key'));
    await expect(service.create(dto)).rejects.toThrow(BadGatewayException);
    expect(session).toMatchObject({ status: SessionStatus.FAILED });
    expect(recall.createBot).toHaveBeenCalledTimes(1);
  });

  it('reuses matching idempotency keys and rejects changes to the request', async () => {
    prisma.session.findUnique.mockResolvedValueOnce(null);
    await service.create(dto, 'request-1');
    await service.create(dto, 'request-1');
    expect(recall.createBot).toHaveBeenCalledTimes(1);
    await expect(
      service.create({ ...dto, title: 'Different workflow' }, 'request-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('does not overwrite a lifecycle status received during bot creation', async () => {
    recall.createBot.mockImplementation(async () => {
      session.status = SessionStatus.RECORDING;
      session.recallBotId = 'bot-1';
      return { id: 'bot-1' };
    });
    await expect(service.create(dto)).resolves.toMatchObject({
      status: SessionStatus.RECORDING,
    });
  });

  it('attempts to remove an orphaned bot when attaching it to the database fails', async () => {
    prisma.session.updateMany.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await expect(service.create(dto)).rejects.toThrow('database unavailable');
    expect(recall.leaveCall).toHaveBeenCalledWith('bot-1');
  });

  it('makes stop requests idempotent and waits for a webhook to confirm the end', async () => {
    Object.assign(session, {
      status: SessionStatus.RECORDING,
      recallBotId: 'bot-1',
    });
    await expect(service.stop(session.id)).resolves.toMatchObject({
      status: SessionStatus.STOPPING,
    });
    await service.stop(session.id);
    expect(recall.leaveCall).toHaveBeenCalledTimes(1);
  });

  it('restores the previous status when Recall rejects a stop request', async () => {
    Object.assign(session, {
      status: SessionStatus.RECORDING,
      recallBotId: 'bot-1',
    });
    recall.leaveCall.mockRejectedValue(new BadGatewayException());
    await expect(service.stop(session.id)).rejects.toThrow(BadGatewayException);
    expect(session.status).toBe(SessionStatus.RECORDING);
  });

  it('rejects stopping a session whose bot has not been created yet', async () => {
    await expect(service.stop(session.id)).rejects.toThrow(ConflictException);
  });
});
