import { PrismaService } from '../prisma/prisma.service';
import { SessionStatus } from '../generated/prisma/enums';
import { RecallWebhooksWorker } from './recall-webhooks.worker';

describe('Durable Recall webhook processing', () => {
  let prisma: any;
  let delivery: any;
  let session: any;
  let worker: RecallWebhooksWorker;

  beforeEach(() => {
    delivery = {
      id: 'delivery-1',
      attempts: 0,
      processedAt: null,
      lockedUntil: null,
      payload: {
        event: 'bot.in_call_recording',
        data: {
          bot: { id: 'bot-1' },
          data: {
            code: 'in_call_recording',
            updated_at: '2026-10-03T12:00:00Z',
          },
        },
      },
    };
    session = {
      id: 'session-1',
      status: SessionStatus.JOINING,
      lastRecallEventAt: null,
    };
    prisma = {
      session: {
        findFirst: jest.fn(async () => session),
        updateMany: jest.fn(async ({ data, where }) => {
          const timestamp = where.OR?.[1].lastRecallEventAt.lt;
          if (
            session.lastRecallEventAt &&
            session.lastRecallEventAt >= timestamp
          )
            return { count: 0 };
          Object.assign(session, data);
          return { count: 1 };
        }),
      },
      sessionEvent: { upsert: jest.fn().mockResolvedValue({}) },
      recallWebhookDelivery: {
        findMany: jest.fn(async () =>
          delivery.processedAt ? [] : [{ ...delivery }],
        ),
        updateMany: jest.fn(async ({ data }) => {
          if (delivery.lockedUntil && delivery.lockedUntil > new Date())
            return { count: 0 };
          delivery.lockedUntil = data.lockedUntil;
          delivery.attempts++;
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }) => Object.assign(delivery, data)),
      },
      $transaction: jest.fn(async (fn) => fn(prisma)),
    };
    worker = new RecallWebhooksWorker(prisma as PrismaService);
  });

  it('records an event and applies its status before marking the inbox receipt processed', async () => {
    await worker.processPending();
    expect(session.status).toBe(SessionStatus.RECORDING);
    expect(prisma.sessionEvent.upsert.mock.calls[0][0].create).toMatchObject({
      deliveryId: 'delivery-1',
      sessionId: 'session-1',
    });
    expect(delivery.processedAt).toBeInstanceOf(Date);
  });

  it('retains late events as evidence without regressing session status', async () => {
    session.status = SessionStatus.ENDED;
    session.lastRecallEventAt = new Date('2026-10-03T12:01:00Z');
    await worker.processPending();
    expect(session.status).toBe(SessionStatus.ENDED);
    expect(prisma.sessionEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not process completed receipts again', async () => {
    await worker.processPending();
    await worker.processPending();
    expect(prisma.sessionEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('retries unmatched sessions instead of dropping a webhook received before bot creation completes', async () => {
    prisma.session.findFirst.mockResolvedValue(null);
    const log = jest
      .spyOn((worker as any).logger, 'error')
      .mockImplementation(() => undefined);
    await worker.processPending();
    expect(delivery.processedAt).toBeNull();
    expect(delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(delivery.lockedUntil).toBeNull();
    expect(prisma.sessionEvent.upsert).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('skips a delivery already leased by another worker', async () => {
    delivery.lockedUntil = new Date(Date.now() + 30000);
    await worker.processPending();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('preserves a failure even when done was delivered before an older fatal event', async () => {
    session.status = SessionStatus.COMPLETED;
    session.lastRecallEventAt = new Date('2026-10-03T12:01:00Z');
    delivery.payload.event = 'bot.fatal';
    Object.assign(delivery.payload.data.data, {
      code: 'fatal',
      sub_code: 'google_meet_sign_in_failed',
    });
    await worker.processPending();
    expect(session.status).toBe(SessionStatus.FAILED);
    expect(session.error).toBe('google_meet_sign_in_failed');
    expect(session.lastRecallEventAt.toISOString()).toBe(
      '2026-10-03T12:01:00.000Z',
    );
  });

  it('records permission events without advancing the lifecycle timestamp', async () => {
    delivery.payload.event = 'bot.recording_permission_allowed';
    delivery.payload.data.data.code = 'recording_permission_allowed';
    await worker.processPending();
    expect(session.lastRecallEventAt).toBeNull();
    expect(prisma.sessionEvent.upsert).toHaveBeenCalledTimes(1);
  });

  it('recovers a bot created despite a timeout using signed session metadata', async () => {
    Object.assign(session, {
      status: SessionStatus.FAILED,
      recallBotId: null,
      error: 'creation failed',
    });
    await worker.processPending();
    expect(session).toMatchObject({
      status: SessionStatus.RECORDING,
      recallBotId: 'bot-1',
      error: null,
    });
  });
});
