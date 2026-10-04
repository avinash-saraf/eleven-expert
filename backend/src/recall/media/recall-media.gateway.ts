import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { EventEmitter } from 'node:events';
import { IncomingMessage, Server } from 'node:http';
import { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import {
  MAX_MEDIA_MESSAGE_BYTES,
  parseRecallMediaPacket,
  RECALL_MEDIA_PATH,
} from './recall-media.packet';
import { RecallMediaService } from './recall-media.service';
import { OutputSocket, RecallOutputService } from './recall-output.service';
import { RECALL_OUTPUT_PATH } from './recall-output.page';

// The ws package is JavaScript. Keep its boundary limited to the API we use.
interface MediaSocket extends EventEmitter {
  readyState: number;
  ping(): void;
  close(code: number, reason: string): void;
  terminate(): void;
}

interface MediaSocketServer {
  clients: Set<MediaSocket>;
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (client: MediaSocket) => void,
  ): void;
  close(callback: () => void): void;
}

@Injectable()
export class RecallMediaGateway
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RecallMediaGateway.name);
  private readonly websocketServer: MediaSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MEDIA_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  private server?: Server;
  private heartbeat?: NodeJS.Timeout;
  private readonly alive = new WeakSet<MediaSocket>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly media: RecallMediaService,
    private readonly output?: RecallOutputService,
  ) {}

  onApplicationBootstrap() {
    this.server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.server.on('upgrade', this.upgrade);
    this.heartbeat = setInterval(() => {
      for (const client of this.websocketServer.clients) {
        if (!this.alive.has(client)) {
          client.terminate();
          continue;
        }
        this.alive.delete(client);
        if (client.readyState === 1) client.ping();
      }
      this.media.expireInactive();
    }, 30000);
    this.heartbeat.unref();
  }

  private readonly upgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    socket.on('error', () => undefined);
    let url: URL;
    try {
      url = new URL(request.url ?? '', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (
      url.pathname !== RECALL_MEDIA_PATH &&
      url.pathname !== RECALL_OUTPUT_PATH
    ) {
      socket.end(
        'HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    let streamId: string;
    try {
      streamId = this.media.authenticate(
        url.searchParams.get('streamId') ?? '',
        url.searchParams.get('token') ?? '',
      );
    } catch {
      socket.end(
        'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    this.websocketServer.handleUpgrade(request, socket, head, (client) => {
      this.alive.add(client);
      client.on('pong', () => this.alive.add(client));
      client.on('error', () =>
        this.logger.warn(`Recall media socket error: stream=${streamId}`),
      );
      if (url.pathname === RECALL_OUTPUT_PATH) {
        if (!this.output) {
          client.close(1011, 'Output unavailable');
          return;
        }
        this.output.attach(streamId, client as unknown as OutputSocket);
        return;
      }
      this.media.connected(streamId);
      client.on('close', () => this.media.disconnected(streamId));
      client.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const buffer = Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw as Uint8Array);
          const packet = parseRecallMediaPacket(
            JSON.parse(buffer.toString('utf8')),
          );
          if (packet) this.media.ingest(streamId, packet);
        } catch {
          this.logger.warn(`Invalid Recall media packet: stream=${streamId}`);
          client.close(1007, 'Invalid media packet');
        }
      });
    });
  };

  async onModuleDestroy() {
    clearInterval(this.heartbeat);
    this.server?.removeListener('upgrade', this.upgrade);
    for (const client of this.websocketServer.clients) client.terminate();
    await new Promise<void>((resolve) =>
      this.websocketServer.close(() => resolve()),
    );
  }
}
