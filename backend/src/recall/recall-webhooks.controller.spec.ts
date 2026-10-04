import { RecallWebhooksController } from './recall-webhooks.controller';
import { RecallWebhookVerifier } from './recall-webhook.verifier';
import { PrismaService } from '../prisma/prisma.service';

describe('Recall lifecycle routing', () => {
  const verify = jest.fn().mockReturnValue('delivery-1');
  const upsert = jest.fn().mockResolvedValue({});
  const controller = new RecallWebhooksController(
    { verify } as unknown as RecallWebhookVerifier,
    { recallWebhookDelivery: { upsert } } as unknown as PrismaService,
  );

  beforeEach(() => jest.clearAllMocks());

  function request(metadata: Record<string, string>) {
    return {
      headers: {},
      rawBody: Buffer.from('{}'),
      body: {
        event: 'bot.in_call_recording',
        data: {
          bot: { id: 'bot-1', metadata },
          data: {
            code: 'in_call_recording',
            updated_at: '2026-10-03T20:00:00Z',
          },
        },
      },
    } as Parameters<RecallWebhooksController['receive']>[0];
  }

  it('acknowledges authenticated media-only bots without queueing an unassociated session', async () => {
    await expect(
      controller.receive(request({ media_stream_id: 'stream-1' })),
    ).resolves.toEqual({ accepted: true, ignored: true });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('still durably queues session lifecycle events', async () => {
    await expect(
      controller.receive(
        request({ session_id: 'db95c70a-e045-4311-8d71-130b36d17062' }),
      ),
    ).resolves.toEqual({ accepted: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'delivery-1' } }),
    );
  });
});
