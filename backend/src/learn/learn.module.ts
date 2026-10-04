import { Module } from '@nestjs/common';
import { MomentsModule } from '../moments/moments.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RecallModule } from '../recall/recall.module';
import { LearnConfiguration } from './learn.configuration';
import { ClaudeService } from './claude.service';
import { ElevenAgentsService } from './elevenagents.service';
import { GraphService } from './graph.service';
import { LearnService } from './learn.service';

@Module({
  imports: [PrismaModule, RecallModule, MomentsModule],
  providers: [
    LearnConfiguration,
    ClaudeService,
    ElevenAgentsService,
    GraphService,
    LearnService,
  ],
  exports: [LearnService, GraphService],
})
export class LearnModule {}
