import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export interface OutputSocket extends EventEmitter {
  readyState: number;
  bufferedAmount: number;
  send(data: string | Buffer, callback?: (error?: Error) => void): void;
  close(code: number, reason: string): void;
}

@Injectable()
export class RecallOutputService implements OnModuleDestroy {
  private readonly players = new Map<
    string,
    { socket: OutputSocket; ready: boolean; agentRate?: number }
  >();

  attach(streamId: string, socket: OutputSocket) {
    this.players.get(streamId)?.socket.close(1000, 'Replaced output player');
    const player = { socket, ready: false };
    this.players.set(streamId, player);
    socket.on('message', (raw: Buffer) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'ready') player.ready = true;
      } catch {
        socket.close(1007, 'Invalid playback event');
      }
    });
    socket.on('close', () => {
      if (this.players.get(streamId) === player) this.players.delete(streamId);
    });
  }

  isReady(streamId: string) {
    const player = this.players.get(streamId);
    return !!player?.ready && player.socket.readyState === 1;
  }

  async play(
    streamId: string,
    chunks: AsyncIterable<Buffer>,
    signal: AbortSignal,
    timing: { onFirstAudio?: () => void; onPlaybackStarted?: () => void } = {},
  ) {
    const player = this.players.get(streamId);
    if (!this.isReady(streamId))
      throw new Error('Recall output player is not ready');
    const socket = player.socket;
    const speechId = randomUUID();
    const cleanup: Array<() => void> = [];
    let rejectPlayback: (error: Error) => void;
    let firstAudio = false;
    let playbackStarted = false;
    const completed = new Promise<void>((resolve, reject) => {
      rejectPlayback = reject;
      const message = (raw: Buffer) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.type === 'playback_error')
            reject(new Error('Recall playback failed'));
          if (
            data.speechId === speechId &&
            data.type === 'playback_started' &&
            !playbackStarted
          ) {
            playbackStarted = true;
            timing.onPlaybackStarted?.();
          }
          if (data.speechId === speechId && data.type === 'playback_finished')
            resolve();
        } catch {
          reject(new Error('Invalid playback event'));
        }
      };
      socket.on('message', message);
      cleanup.push(() => socket.removeListener('message', message));
    });
    // Attach a handler immediately: disconnection can happen while TTS is yielding.
    void completed.catch(() => undefined);
    const abort = () => rejectPlayback(new Error('Speech cancelled'));
    const closed = () =>
      rejectPlayback(new Error('Recall output disconnected'));
    socket.once('close', closed);
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      await this.send(
        socket,
        JSON.stringify({ type: 'speech_start', speechId }),
      );
      let tail: Buffer = Buffer.alloc(0);
      for await (const chunk of chunks) {
        signal.throwIfAborted();
        const bytes = tail.length ? Buffer.concat([tail, chunk]) : chunk;
        const aligned = bytes.length - (bytes.length % 2);
        tail = bytes.subarray(aligned);
        if (aligned) {
          await this.send(socket, bytes.subarray(0, aligned));
          if (!firstAudio) {
            firstAudio = true;
            timing.onFirstAudio?.();
          }
        }
      }
      if (tail.length) throw new Error('Incomplete PCM sample');
      await this.send(socket, JSON.stringify({ type: 'speech_end', speechId }));
      await completed;
    } catch (error) {
      if (socket.readyState === 1)
        socket.send(JSON.stringify({ type: 'cancel' }));
      throw error;
    } finally {
      cleanup.forEach((fn) => fn());
      socket.removeListener('close', closed);
      signal.removeEventListener('abort', abort);
    }
  }

  /**
   * Continuous playback for a live ElevenAgents conversation. The agent streams audio
   * faster than real time, so chunks are queued on the page and only `cancel` (an
   * interruption) clears them.
   */
  streamAgentAudio(streamId: string, pcm: Buffer, sampleRate: number) {
    const player = this.players.get(streamId);
    if (!player || !this.isReady(streamId) || !pcm.length) return;
    const socket = player.socket;
    if (socket.bufferedAmount > 512 * 1024) return;
    const aligned = pcm.subarray(0, pcm.length - (pcm.length % 2));
    if (!aligned.length) return;
    if (player.agentRate !== sampleRate) {
      player.agentRate = sampleRate;
      socket.send(JSON.stringify({ type: 'agent_stream', sampleRate }));
    }
    socket.send(aligned);
  }

  /** Shows a picture on the bot's camera tile in the meeting, then fades back by itself. */
  showImage(
    streamId: string,
    image: {
      jpeg: Buffer;
      caption: string;
      quote?: string | null;
      seconds?: number;
    },
  ) {
    const socket = this.players.get(streamId)?.socket;
    if (socket?.readyState !== 1 || socket.bufferedAmount > 2 * 1024 * 1024)
      return false;
    socket.send(
      JSON.stringify({
        type: 'show',
        mime: 'image/jpeg',
        data: image.jpeg.toString('base64'),
        caption: image.caption.slice(0, 200),
        quote: image.quote?.slice(0, 240) ?? '',
        seconds: image.seconds ?? 20,
      }),
    );
    return true;
  }

  hideImage(streamId: string) {
    const socket = this.players.get(streamId)?.socket;
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'hide' }));
  }

  cancel(streamId: string) {
    const socket = this.players.get(streamId)?.socket;
    if (socket?.readyState === 1)
      socket.send(JSON.stringify({ type: 'cancel' }));
  }

  onModuleDestroy() {
    for (const player of this.players.values())
      player.socket.close(1001, 'Backend shutting down');
    this.players.clear();
  }

  private send(socket: OutputSocket, data: string | Buffer) {
    if (socket.readyState !== 1 || socket.bufferedAmount > 512 * 1024)
      throw new Error('Recall output unavailable or congested');
    return new Promise<void>((resolve, reject) =>
      socket.send(data, (error) => (error ? reject(error) : resolve())),
    );
  }
}
