import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { LearnConfiguration } from './learn.configuration';
import { providerError } from './apprentice-error';

interface SpeechSocket extends EventEmitter {
  readyState: number;
  bufferedAmount: number;
  send(value: string): void;
  terminate(): void;
}

export interface TranscriptionStream {
  write(pcm: Buffer): void;
  finish(): Promise<void>;
  close(): void;
}

@Injectable()
export class ElevenLabsService {
  constructor(private readonly configuration: LearnConfiguration) {}

  transcribe(
    onText: (text: string, committed: boolean) => void,
    onError: () => void,
  ): TranscriptionStream {
    const { elevenKey } = this.configuration.get();
    let socket: SpeechSocket;
    let closed = false;
    let reconnect: NodeJS.Timeout;
    let retryDelay = 1000;
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let lastWrite = Date.now();
    let started = false;
    let flushDone: (() => void) | undefined;
    const send = (pcm: Buffer) => {
      if (socket?.readyState !== 1 || !started) return false;
      if (socket.bufferedAmount > 128 * 1024) {
        socket.terminate();
        return false;
      }
      socket.send(
        JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: pcm.toString('base64'),
          sample_rate: 16000,
        }),
      );
      return true;
    };
    const connect = () => {
      if (closed) return;
      started = false;
      const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
      url.search = new URLSearchParams({
        model_id: 'scribe_v2_realtime',
        audio_format: 'pcm_16000',
        commit_strategy: 'vad',
        vad_silence_threshold_secs: '0.5',
        min_silence_duration_ms: '100',
      }).toString();
      socket = new WebSocket(url.toString(), {
        headers: { 'xi-api-key': elevenKey },
        handshakeTimeout: 10000,
        maxPayload: 1024 * 1024,
      }) as SpeechSocket;
      socket.on('message', (raw: Buffer) => {
        try {
          const event = JSON.parse(raw.toString());
          if (event.message_type === 'session_started') {
            started = true;
            retryDelay = 1000;
            for (const pcm of pending) if (!send(pcm)) break;
            pending = [];
            pendingBytes = 0;
          }
          if (
            ['partial_transcript', 'committed_transcript'].includes(
              event.message_type,
            ) &&
            typeof event.text === 'string'
          ) {
            onText(event.text, event.message_type === 'committed_transcript');
            if (event.message_type === 'committed_transcript') flushDone?.();
          }
          if (
            event.error ||
            String(event.message_type).includes('error') ||
            event.message_type === 'rate_limited'
          ) {
            onError();
            socket.terminate();
          }
        } catch {
          onError();
        }
      });
      socket.on('error', () => onError());
      socket.on('close', () => {
        started = false;
        flushDone?.();
        if (!closed) {
          onError();
          reconnect = setTimeout(connect, retryDelay);
          reconnect.unref();
          retryDelay = Math.min(retryDelay * 2, 10000);
        }
      });
    };
    connect();
    // Recall emits empty buffers during silence. Supply real PCM silence so
    // Scribe VAD can commit the last utterance even when the expert mutes.
    const silence = setInterval(() => {
      if (!closed && started && Date.now() - lastWrite >= 180)
        send(Buffer.alloc(6400));
    }, 200);
    silence.unref();
    const close = () => {
      closed = true;
      clearInterval(silence);
      clearTimeout(reconnect);
      pending = [];
      socket?.terminate();
    };
    return {
      write(pcm) {
        if (closed || !pcm.length) return;
        lastWrite = Date.now();
        if (!send(pcm)) {
          pending.push(pcm);
          pendingBytes += pcm.length;
          while (pendingBytes > 64000 && pending.length)
            pendingBytes -= pending.shift().length;
        }
      },
      async finish() {
        if (started && !closed) {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 1500);
            flushDone = () => {
              clearTimeout(timeout);
              resolve();
            };
            send(Buffer.alloc(32000));
          });
          flushDone = undefined;
        }
        close();
      },
      close,
    };
  }

  async *speak(text: string, signal: AbortSignal): AsyncGenerator<Buffer> {
    const { elevenKey, voiceId, ttsModel } = this.configuration.get();
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=pcm_24000`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': 'application/json',
          Accept: 'application/octet-stream',
        },
        body: JSON.stringify({ text, model_id: ttsModel }),
        signal,
      },
    );
    if (!response.ok)
      throw await providerError(`ElevenLabs voice=${voiceId}`, response, [
        elevenKey,
      ]);
    if (!response.body) throw new Error('Incomplete PCM speech response');
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield Buffer.from(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
