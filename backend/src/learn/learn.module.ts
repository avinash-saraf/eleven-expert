import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecallModule } from '../recall/recall.module';
import { LearnConfiguration } from './learn.configuration';
import { ClaudeService } from './claude.service';
import { ElevenLabsService } from './elevenlabs.service';
import { LearnService } from './learn.service';

@Module({
  imports: [PrismaModule, RecallModule],
  providers: [
    LearnConfiguration,
    ClaudeService,
    ElevenLabsService,
    LearnService,
  ],
  exports: [LearnService],
})
export class LearnModule {}
