import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { RecallConfiguration } from '../recall/recall.configuration';
import { RecallService } from '../recall/recall.service';
import { RecallMediaService } from '../recall/media/recall-media.service';

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly recall: RecallService,
    private readonly configuration: RecallConfiguration,
    private readonly media: RecallMediaService,
  ) {}

  async join(meetingUrl: string) {
    return this.createBot(meetingUrl, this.prepareStream());
  }

  prepareStream() {
    this.configuration.getApi();
    const stream = this.media.register();
    let websocketUrl: string;
    try {
      websocketUrl = this.configuration.getMediaWebSocketUrl(
        stream.id,
        stream.token,
      );
    } catch (error) {
      this.media.discard(stream.id);
      throw error;
    }
    return { id: stream.id, websocketUrl };
  }

  async createBot(
    meetingUrl: string,
    stream: { id: string; websocketUrl: string },
    metadata: Record<string, string> = {},
    outputPageUrl?: string,
  ) {
    let botId: string;
    try {
      botId = (
        await this.recall.createMediaBot(
          meetingUrl,
          stream.id,
          stream.websocketUrl,
          metadata,
          outputPageUrl,
        )
      ).id;
    } catch {
      this.media.creationFailed(stream.id);
      throw new BadGatewayException({
        message: 'Recall bot creation failed; inspect Recall before retrying',
        streamId: stream.id,
      });
    }
    try {
      this.media.bindBot(stream.id, botId);
    } catch (error) {
      try {
        await this.recall.leaveCall(botId);
      } catch {
        this.logger.error(`Could not remove mismatched Recall bot ${botId}`);
      }
      throw error;
    }
    return {
      botId,
      streamId: stream.id,
      mediaStatusUrl: `/meetings/${stream.id}/media`,
    };
  }
}
