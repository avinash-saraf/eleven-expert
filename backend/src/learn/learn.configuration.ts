import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
      // Created by `npm run agents:create`; one interviewer, one tutor.
      learnAgentId: this.required('ELEVENLABS_LEARN_AGENT_ID'),
      teachAgentId: this.required('ELEVENLABS_TEACH_AGENT_ID'),
      // Optional per-session override of the agent's configured voice.
      voiceId: this.config.get<string>('ELEVENLABS_VOICE_ID')?.trim() || '',
      // The LLM behind the interviewer and tutor, chosen per session.
      agentLlm:
        this.config.get<string>('ELEVENLABS_AGENT_LLM')?.trim() ||
        'claude-sonnet-4-5',
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
