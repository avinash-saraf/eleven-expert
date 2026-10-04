import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, RecallWebhookDelivery } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionStatus } from '../generated/prisma/enums';
import { RecallMediaService } from './media/recall-media.service';
import {
  nextSessionStatus,
  parseRecallEvent,
  recallSessionStatus,
} from './recall-event';

@Injectable()
export class RecallWebhooksWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecallWebhooksWorker.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly media?: RecallMediaService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.processPending().catch(() =>
        this.logger.error('Recall webhook inbox could not be read'),
      );
    }, 1000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.active?.catch(() => undefined);
  }

  processPending() {
    if (this.active) return this.active;
    this.active = this.run().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }

  private async run() {
    const now = new Date();
    const available: Prisma.RecallWebhookDeliveryWhereInput = {
      processedAt: null,
      attempts: { lt: 20 },
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    };
    const deliveries = await this.prisma.recallWebhookDelivery.findMany({
      where: available,
      orderBy: { receivedAt: 'asc' },
      take: 10,
    });
    for (const delivery of deliveries) {
      const claimed = await this.prisma.recallWebhookDelivery.updateMany({
        where: { ...available, id: delivery.id },
        data: {
          lockedUntil: new Date(Date.now() + 30000),
          attempts: { increment: 1 },
        },
      });
      if (!claimed.count) continue;
      try {
        await this.processDelivery(delivery);
      } catch {
        await this.prisma.recallWebhookDelivery.update({
          where: { id: delivery.id },
          data: {
            lockedUntil: null,
            nextAttemptAt: new Date(
              Date.now() + Math.min(30000, 1000 * 2 ** delivery.attempts),
            ),
            lastError:
              'Could not apply lifecycle event; verify session association and database availability',
          },
        });
        this.logger.error(
          `Recall delivery ${delivery.id} failed on attempt ${delivery.attempts + 1}`,
        );
      }
    }
  }

  private async processDelivery(delivery: RecallWebhookDelivery) {
    const event = parseRecallEvent(delivery.payload);
    let endedStream: string | undefined;
    await this.prisma.$transaction(
      async (tx) => {
        if (event) {
          const session = await tx.session.findFirst({
            where: {
              OR: [
                { recallBotId: event.botId },
                ...(event.sessionId
                  ? [{ id: event.sessionId, recallBotId: null }]
                  : []),
              ],
            },
          });
          if (!session) throw new Error('Session association is not available');
          if (
            session.mediaStreamId &&
            ['call_ended', 'done', 'fatal'].includes(event.code)
          )
            endedStream = session.mediaStreamId;
          await tx.sessionEvent.upsert({
            where: { deliveryId: delivery.id },
            create: {
              sessionId: session.id,
              deliveryId: delivery.id,
              type: event.type,
              payload: delivery.payload as Prisma.InputJsonValue,
              occurredAt: event.occurredAt,
            },
            update: {},
          });
          // A timed-out create request can still produce a bot. A signed event
          // with our metadata recovers that association without creating another.
          const recovered =
            session.status === SessionStatus.FAILED &&
            !session.recallBotId &&
            !session.lastRecallEventAt;
          const status = nextSessionStatus(
            recovered ? SessionStatus.CREATING : session.status,
            event.code,
          );
          const lateFatal =
            event.code === 'fatal' &&
            session.lastRecallEventAt &&
            session.lastRecallEventAt >= event.occurredAt;
          if (lateFatal) {
            await tx.session.updateMany({
              where: { id: session.id, status: session.status },
              data: {
                status: SessionStatus.FAILED,
                error: event.subCode ?? 'Recall bot failed',
              },
            });
          } else if (recallSessionStatus(event.code)) {
            await tx.session.updateMany({
              where: {
                id: session.id,
                status: session.status,
                OR: [
                  { lastRecallEventAt: null },
                  { lastRecallEventAt: { lt: event.occurredAt } },
                ],
              },
              data: {
                recallBotId: event.botId,
                recallStatus: event.code,
                lastRecallEventAt: event.occurredAt,
                status,
                ...(recovered && event.code !== 'fatal' ? { error: null } : {}),
                ...(event.code === 'fatal'
                  ? { error: event.subCode ?? 'Recall bot failed' }
                  : {}),
              },
            });
          }
        }
        await tx.recallWebhookDelivery.update({
          where: { id: delivery.id },
          data: { processedAt: new Date(), lockedUntil: null, lastError: null },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (endedStream) this.media?.end(endedStream);
  }
}
