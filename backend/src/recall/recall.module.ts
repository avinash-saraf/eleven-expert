import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecallConfiguration } from './recall.configuration';
import { RecallService } from './recall.service';
import { RecallWebhookVerifier } from './recall-webhook.verifier';
import { RecallWebhooksController } from './recall-webhooks.controller';
import { RecallWebhooksWorker } from './recall-webhooks.worker';
import { RecallMediaService } from './media/recall-media.service';
import { RecallMediaGateway } from './media/recall-media.gateway';
import { RecallOutputService } from './media/recall-output.service';
import { RecallOutputController } from './media/recall-output.controller';

@Module({
  imports: [PrismaModule],
  controllers: [RecallWebhooksController, RecallOutputController],
  providers: [
    RecallConfiguration,
    RecallService,
    RecallWebhookVerifier,
    RecallWebhooksWorker,
    RecallMediaService,
    RecallMediaGateway,
    RecallOutputService,
  ],
  exports: [
    RecallService,
    RecallConfiguration,
    RecallMediaService,
    RecallOutputService,
  ],
})
export class RecallModule {}
