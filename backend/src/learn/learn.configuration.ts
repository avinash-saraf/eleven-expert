import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Voice used by ElevenLabs' official streaming example; demos can override it.
const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';

@Injectable()
export class LearnConfiguration {
  constructor(private readonly config: ConfigService) {}

  get() {
    return {
      anthropicKey: this.required('ANTHROPIC_API_KEY'),
      anthropicModel:
        this.config.get<string>('ANTHROPIC_MODEL')?.trim() ||
        'claude-sonnet-5-5',
      elevenKey: this.required('ELEVENLABS_API_KEY'),
      voiceId:
        this.config.get<string>('ELEVENLABS_VOICE_ID')?.trim() ||
        DEFAULT_VOICE_ID,
      ttsModel:
        this.config.get<string>('ELEVENLABS_TTS_MODEL')?.trim() ||
        'eleven_flash_v2_5',
    };
  }

  private required(name: string) {
    const value = this.config.get<string>(name)?.trim();
    if (!value)
      throw new ServiceUnavailableException(
        `${name} is required for live AI Apprentice sessions`,
      );
    return value;
  }
}
