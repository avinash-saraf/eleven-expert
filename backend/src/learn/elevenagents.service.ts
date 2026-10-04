import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { LearnConfiguration } from './learn.configuration';
import { providerError } from './apprentice-error';

export interface AgentToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

export interface AgentHandlers {
  /** PCM16 mono audio from the agent, at `sampleRate`. */
  onAudio(pcm: Buffer, sampleRate: number): void;
  /** The expert/learner started talking over the agent: stop playback now. */
  onInterruption(): void;
  onUserTranscript(text: string): void;
  onAgentResponse(text: string): void;
  /** Return the string the agent should receive as the tool result. */
  onToolCall(call: AgentToolCall): Promise<string> | string;
  onClose(): void;
  onError(message: string): void;
}

export interface AgentConversation {
  readonly ready: boolean;
  /** 16 kHz PCM16 mono microphone audio of the person being coached or interviewed. */
  sendAudio(pcm: Buffer): void;
  /** Background knowledge. Never makes the agent speak. */
  contextualUpdate(text: string): void;
  /** Text the agent must react to now, e.g. a screen alert. */
  say(text: string): void;
  close(): void;
}

function sampleRateOf(format: unknown, fallback: number) {
  const match = /^pcm_(\d+)$/.exec(String(format));
  return match ? Number(match[1]) : fallback;
}

@Injectable()
export class ElevenAgentsService {
  constructor(private readonly configuration: LearnConfiguration) {}

  async open(
    agentId: string,
    override: { prompt: string; firstMessage: string; language?: string },
    handlers: AgentHandlers,
  ): Promise<AgentConversation> {
    const { elevenKey, voiceId, agentLlm } = this.configuration.get();
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      {
        headers: { 'xi-api-key': elevenKey },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw await providerError(`ElevenAgents agent=${agentId}`, response, [
        elevenKey,
      ]);
    const { signed_url: signedUrl } = (await response.json()) as {
      signed_url?: string;
    };
    if (!signedUrl) throw new Error('ElevenAgents returned no signed URL');

    const socket = new WebSocket(signedUrl, {
      handshakeTimeout: 10000,
      maxPayload: 4 * 1024 * 1024,
    });
    let ready = false;
    let closed = false;
    let outputRate = 24000;
    let inputRate = 16000;
    const send = (message: unknown) => {
      if (socket.readyState === 1 && !closed)
        socket.send(JSON.stringify(message));
    };

    socket.on('open', () =>
      send({
        type: 'conversation_initiation_client_data',
        conversation_config_override: {
          agent: {
            prompt: { prompt: override.prompt, llm: agentLlm },
            first_message: override.firstMessage,
            ...(override.language ? { language: override.language } : {}),
          },
          ...(voiceId ? { tts: { voice_id: voiceId } } : {}),
        },
      }),
    );
    socket.on('message', (raw: Buffer) => {
      let event: any;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return handlers.onError('Unreadable ElevenAgents message');
      }
      switch (event.type) {
        case 'conversation_initiation_metadata': {
          const meta = event.conversation_initiation_metadata_event ?? {};
          outputRate = sampleRateOf(meta.agent_output_audio_format, 24000);
          inputRate = sampleRateOf(meta.user_input_audio_format, 16000);
          if (inputRate !== 16000)
            handlers.onError(
              `Agent expects ${inputRate} Hz input; set asr.user_input_audio_format to pcm_16000`,
            );
          ready = inputRate === 16000;
          break;
        }
        case 'audio': {
          const chunk = event.audio_event?.audio_base_64;
          if (typeof chunk === 'string' && chunk)
            handlers.onAudio(Buffer.from(chunk, 'base64'), outputRate);
          break;
        }
        case 'interruption':
          handlers.onInterruption();
          break;
        case 'user_transcript': {
          const text = event.user_transcription_event?.user_transcript;
          if (typeof text === 'string' && text.trim())
            handlers.onUserTranscript(text.trim());
          break;
        }
        case 'agent_response': {
          const text = event.agent_response_event?.agent_response;
          if (typeof text === 'string' && text.trim())
            handlers.onAgentResponse(text.trim());
          break;
        }
        case 'ping':
          send({ type: 'pong', event_id: event.ping_event?.event_id });
          break;
        case 'client_tool_call': {
          const call = event.client_tool_call ?? {};
          void Promise.resolve()
            .then(() =>
              handlers.onToolCall({
                name: String(call.tool_name),
                parameters: call.parameters ?? {},
              }),
            )
            .then(
              (result) => ({ result, is_error: false }),
              (error) => ({
                result: error instanceof Error ? error.message : 'failed',
                is_error: true,
              }),
            )
            .then((outcome) => {
              if (call.expects_response !== false)
                send({
                  type: 'client_tool_result',
                  tool_call_id: call.tool_call_id,
                  result: outcome.result,
                  is_error: outcome.is_error,
                });
            });
          break;
        }
        case 'client_error':
          handlers.onError(
            `ElevenAgents: ${event.error_event?.message ?? 'client error'}`,
          );
          break;
      }
    });
    socket.on('error', () => handlers.onError('ElevenAgents socket error'));
    socket.on('close', () => {
      ready = false;
      if (!closed) {
        closed = true;
        handlers.onClose();
      }
    });

    return {
      get ready() {
        return ready && socket.readyState === 1;
      },
      sendAudio(pcm) {
        if (!ready || !pcm.length || socket.bufferedAmount > 256 * 1024) return;
        send({ user_audio_chunk: pcm.toString('base64') });
      },
      contextualUpdate(text) {
        send({ type: 'contextual_update', text });
      },
      say(text) {
        send({ type: 'user_message', id: randomUUID(), text });
      },
      close() {
        closed = true;
        ready = false;
        socket.terminate();
      },
    };
  }
}
