import { BadGatewayException, Injectable } from '@nestjs/common';
import { RecallConfiguration } from './recall.configuration';

export interface RecallBot {
  id: string;
  status_changes?: Array<{ code: string; created_at: string }>;
}

@Injectable()
export class RecallService {
  constructor(private readonly configuration: RecallConfiguration) {}

  assertConfigured() {
    this.configuration.getApi();
    this.configuration.getWebhookSecret(true);
  }

  async createBot(session: { id: string; meetingUrl: string; mode: string }) {
    const { googleLoginGroupId } = this.configuration.getApi();
    const bot = await this.request<RecallBot>('POST', '/bot/', {
      meeting_url: session.meetingUrl,
      google_meet: { google_login_group_id: googleLoginGroupId },
      metadata: { session_id: session.id, mode: session.mode },
    });
    if (!bot || typeof bot.id !== 'string' || !bot.id) {
      throw new BadGatewayException('Recall returned an invalid bot response');
    }
    return bot;
  }

  async createMediaBot(
    meetingUrl: string,
    streamId: string,
    websocketUrl: string,
    metadata: Record<string, string> = {},
    outputPageUrl?: string,
  ) {
    const { googleLoginGroupId } = this.configuration.getApi();
    const bot = await this.request<RecallBot>('POST', '/bot/', {
      meeting_url: meetingUrl,
      google_meet: {
        google_login_group_id: googleLoginGroupId,
        login_required: true,
      },
      variant: { google_meet: 'web_4_core' },
      metadata: { ...metadata, media_stream_id: streamId },
      ...(outputPageUrl
        ? {
            output_media: {
              camera: { kind: 'webpage', config: { url: outputPageUrl } },
            },
          }
        : {}),
      recording_config: {
        audio_separate_raw: {},
        video_separate_png: {},
        video_mixed_layout: 'gallery_view_v2',
        realtime_endpoints: [
          {
            type: 'websocket',
            url: websocketUrl,
            events: ['audio_separate_raw.data', 'video_separate_png.data'],
          },
        ],
      },
    });
    if (!bot || typeof bot.id !== 'string' || !bot.id) {
      throw new BadGatewayException('Recall returned an invalid bot response');
    }
    return bot;
  }

  retrieveBot(botId: string) {
    return this.request<RecallBot>('GET', `/bot/${encodeURIComponent(botId)}/`);
  }

  async leaveCall(botId: string) {
    await this.request('POST', `/bot/${encodeURIComponent(botId)}/leave_call/`);
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const { baseUrl, apiKey } = this.configuration.getApi();
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        // Do not expose provider response bodies, credentials, or meeting URLs.
        throw new BadGatewayException(
          `Recall request failed (${response.status})`,
        );
      }
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      // Never retry bot creation automatically: a timeout can still create a bot.
      throw new BadGatewayException('Recall request failed or timed out');
    }
  }
}
