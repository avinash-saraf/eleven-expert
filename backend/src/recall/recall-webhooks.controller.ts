import {
  Controller,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { parseRecallEvent } from './recall-event';
import { RecallWebhookVerifier } from './recall-webhook.verifier';

@Controller('webhooks/recall')
export class RecallWebhooksController {
  constructor(
    private readonly verifier: RecallWebhookVerifier,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(202)
  async receive(@Req() request: RawBodyRequest<Request>) {
    const id = this.verifier.verify(request.headers, request.rawBody);
    const event = parseRecallEvent(request.body);
    if (!event || (event.mediaStreamId && !event.sessionId))
      return { accepted: true, ignored: true };
    // Persist before acknowledging. The worker processes this outside the request.
    await this.prisma.recallWebhookDelivery.upsert({
      where: { id },
      create: { id, payload: request.body as Prisma.InputJsonObject },
      update: {},
    });
    return { accepted: true };
  }
}
