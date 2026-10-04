import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const REGIONS = ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-1'];

@Injectable()
export class RecallConfiguration {
  constructor(private readonly config: ConfigService) {}

  getApi() {
    const region = this.required('RECALL_REGION');
    if (!REGIONS.includes(region)) {
      throw new ServiceUnavailableException('RECALL_REGION is invalid');
    }

    return {
      baseUrl: `https://${region}.recall.ai/api/v1`,
      apiKey: this.required('RECALL_API_KEY'),
      googleLoginGroupId:
        this.config.get<string>('GOOGLE_LOGIN_GROUP_ID')?.trim() ||
        this.config.get<string>('RECALL_GOOGLE_LOGIN_GROUP_ID')?.trim() ||
        this.required('GOOGLE_LOGIN_GROUP_ID'),
    };
  }

  getMediaWebSocketUrl(streamId: string, token: string) {
    let url: URL;
    try {
      url = new URL(this.required('RECALL_PUBLIC_WEBSOCKET_URL'));
    } catch {
      throw new ServiceUnavailableException(
        'RECALL_PUBLIC_WEBSOCKET_URL must be a public wss:// URL ending in /recall/media/',
      );
    }
    if (
      url.protocol !== 'wss:' ||
      url.pathname !== '/recall/media/' ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ) {
      throw new ServiceUnavailableException(
        'RECALL_PUBLIC_WEBSOCKET_URL must be a public wss:// URL ending in /recall/media/',
      );
    }
    url.searchParams.set('streamId', streamId);
    url.searchParams.set('token', token);
    return url.toString();
  }

  getWebhookSecret(legacyHeaders: boolean) {
    const legacy = this.config
      .get<string>('RECALL_SVIX_WEBHOOK_SECRET')
      ?.trim();
    const secret =
      legacyHeaders && legacy
        ? legacy
        : this.required('RECALL_WORKSPACE_VERIFICATION_SECRET');
    if (
      !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret) ||
      Buffer.from(secret.slice(6), 'base64').length < 16
    ) {
      throw new ServiceUnavailableException('Recall webhook secret is invalid');
    }
    return secret;
  }

  private required(name: string) {
    const value = this.config.get<string>(name)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(`${name} is not configured`);
    }
    return value;
  }
}
