import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { RecallService } from '../src/recall/recall.service';
import { RecallWebhooksWorker } from '../src/recall/recall-webhooks.worker';

describe('Sessions and signed Recall webhooks (e2e)', () => {
  const apiKey = 'integration-test-session-key';
  const verificationKey = Buffer.alloc(32, 8);
  const workMapIds = new Set<string>();
  const deliveryIds: string[] = [];
  const recall = {
    assertConfigured: jest.fn(),
    createBot: jest.fn(async () => ({ id: randomUUID() })),
    leaveCall: jest.fn().mockResolvedValue(undefined),
  };
  const input = {
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    mode: 'LEARN',
  };
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: RecallWebhooksWorker;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RecallService)
      .useValue(recall)
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          DATABASE_URL: process.env.DATABASE_URL,
          SESSION_API_KEY: apiKey,
          RECALL_WORKSPACE_VERIFICATION_SECRET: `whsec_${verificationKey.toString('base64')}`,
        }),
      )
      .compile();
    app = module.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    worker = app.get(RecallWebhooksWorker);
    // Process the inbox explicitly so test assertions do not depend on timers.
    await worker.onModuleDestroy();
  });

  afterAll(async () => {
    if (prisma && workMapIds.size) {
      await prisma.session.deleteMany({
        where: { workMapId: { in: [...workMapIds] } },
      });
      await prisma.workMap.deleteMany({
        where: { id: { in: [...workMapIds] } },
      });
    }
    if (prisma && deliveryIds.length) {
      await prisma.recallWebhookDelivery.deleteMany({
        where: { id: { in: deliveryIds } },
      });
    }
    await app?.close();
  });

  async function learn() {
    const result = await request(app.getHttpServer())
      .post('/sessions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(input)
      .expect(201);
    workMapIds.add(result.body.workMapId);
    return result.body;
  }

  function signedEvent(
    session: { id: string; recallBotId: string },
    code: string,
    occurredAt: string,
  ) {
    const id = `test-${randomUUID()}`;
    deliveryIds.push(id);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({
      event: `bot.${code}`,
      data: {
        bot: { id: session.recallBotId, metadata: { session_id: session.id } },
        data: { code, updated_at: occurredAt },
      },
    });
    const signature = createHmac('sha256', verificationKey)
      .update(`${id}.${timestamp}.${payload}`)
      .digest('base64');
    return {
      id,
      payload,
      headers: {
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`,
      },
    };
  }

  async function deliver(event: ReturnType<typeof signedEvent>) {
    await request(app.getHttpServer())
      .post('/webhooks/recall')
      .set(event.headers)
      .set('Content-Type', 'application/json')
      .send(event.payload)
      .expect(202);
    await worker.processPending();
  }

  it('protects session routes and validates Google Meet URLs', async () => {
    await request(app.getHttpServer())
      .post('/sessions')
      .send(input)
      .expect(401);
    await request(app.getHttpServer())
      .post('/sessions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...input, meetingUrl: 'https://example.com' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/sessions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...input, mode: 'TEACH' })
      .expect(400);
  });

  it('creates, retrieves, reuses and stops a session while retaining its Work Map', async () => {
    const key = randomUUID();
    const result = await request(app.getHttpServer())
      .post('/sessions')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    const session = result.body;
    workMapIds.add(session.workMapId);
    expect(session).toMatchObject({
      status: 'JOINING',
      mode: 'LEARN',
      workMap: { definition: {} },
    });
    const calls = recall.createBot.mock.calls.length;
    const repeated = await request(app.getHttpServer())
      .post('/sessions')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    expect(repeated.body.id).toBe(session.id);
    expect(recall.createBot).toHaveBeenCalledTimes(calls);
    const retrieved = await request(app.getHttpServer())
      .get(`/sessions/${session.id}`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);
    expect(retrieved.body.recallBotId).toBe(session.recallBotId);
    const teach = await request(app.getHttpServer())
      .post('/sessions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...input, mode: 'TEACH', workMapId: session.workMapId })
      .expect(201);
    expect(teach.body.workMapId).toBe(session.workMapId);
    const stopped = await request(app.getHttpServer())
      .post(`/sessions/${session.id}/stop`)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);
    expect(stopped.body.status).toBe('STOPPING');
    expect(recall.leaveCall).toHaveBeenCalledWith(session.recallBotId);
  });

  it('verifies signatures, deduplicates deliveries, and preserves status on late events', async () => {
    const session = await learn();
    const event = signedEvent(
      session,
      'in_call_recording',
      '2026-10-03T12:01:00Z',
    );
    await request(app.getHttpServer())
      .post('/webhooks/recall')
      .set({ ...event.headers, 'webhook-signature': 'v1,invalid' })
      .set('Content-Type', 'application/json')
      .send(event.payload)
      .expect(401);
    expect(
      await prisma.recallWebhookDelivery.findUnique({
        where: { id: event.id },
      }),
    ).toBeNull();
    await deliver(event);
    await deliver(event);
    await deliver(
      signedEvent(session, 'in_waiting_room', '2026-10-03T12:00:00Z'),
    );
    const persisted = await prisma.session.findUnique({
      where: { id: session.id },
      include: { events: true },
    });
    expect(persisted.status).toBe('RECORDING');
    expect(persisted.events).toHaveLength(2);
    expect(
      await prisma.recallWebhookDelivery.count({ where: { id: event.id } }),
    ).toBe(1);
  });

  it('retains a fatal failure even if Recall subsequently emits done', async () => {
    const session = await learn();
    await deliver(signedEvent(session, 'fatal', '2026-10-03T12:00:00Z'));
    await deliver(signedEvent(session, 'done', '2026-10-03T12:01:00Z'));
    const persisted = await prisma.session.findUnique({
      where: { id: session.id },
    });
    expect(persisted.status).toBe('FAILED');
    expect(persisted.recallStatus).toBe('done');
  });

  it('applies a fatal failure even when its delivery arrives after a newer done event', async () => {
    const session = await learn();
    await deliver(signedEvent(session, 'done', '2026-10-03T12:01:00Z'));
    await deliver(signedEvent(session, 'fatal', '2026-10-03T12:00:00Z'));
    const persisted = await prisma.session.findUnique({
      where: { id: session.id },
    });
    expect(persisted.status).toBe('FAILED');
    expect(persisted.recallStatus).toBe('done');
  });
});
