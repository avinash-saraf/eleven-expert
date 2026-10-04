import { HttpAdapterHost } from '@nestjs/core';
import { EventEmitter } from 'node:events';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { RecallMediaGateway } from './recall-media.gateway';
import { RecallMediaService } from './recall-media.service';
import { mediaFixture, TEST_PNG } from '../../../test/fixtures/recall-media';

class MemorySocket extends Duplex {
  readonly writes: Buffer[] = [];
  _read() {}
  _write(chunk: Buffer, encoding: BufferEncoding, callback: () => void) {
    this.writes.push(Buffer.from(chunk));
    callback();
  }
}

// Encode a masked text frame as a real WebSocket client would send it. This
// exercises ws's protocol decoder without opening a forbidden network listener.
function clientFrame(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  const extended = payload.length >= 126;
  const header = Buffer.alloc(extended ? 8 : 6);
  header[0] = 0x81;
  header[1] = 0x80 | (extended ? 126 : payload.length);
  if (extended) header.writeUInt16BE(payload.length, 2);
  const mask = Buffer.from([1, 2, 3, 4]);
  mask.copy(header, extended ? 4 : 2);
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return Buffer.concat([header, payload]);
}

describe('Native Recall WebSocket ingestion', () => {
  let server: EventEmitter;
  let media: RecallMediaService;
  let gateway: RecallMediaGateway;
  let sockets: MemorySocket[];

  beforeEach(() => {
    sockets = [];
    server = new EventEmitter();
    media = new RecallMediaService();
    const host = {
      httpAdapter: { getHttpServer: () => server },
    } as unknown as HttpAdapterHost;
    gateway = new RecallMediaGateway(host, media);
    gateway.onApplicationBootstrap();
  });

  afterEach(async () => {
    await gateway.onModuleDestroy();
    sockets.forEach((socket) => socket.destroy());
    media.onModuleDestroy();
  });

  function upgrade(streamId: string, token: string) {
    const socket = new MemorySocket();
    sockets.push(socket);
    const req = new IncomingMessage(socket as unknown as Socket);
    req.method = 'GET';
    req.url = `/recall/media/?streamId=${streamId}&token=${token}`;
    req.headers = {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-version': '13',
      'sec-websocket-key': Buffer.alloc(16, 1).toString('base64'),
    };
    server.emit('upgrade', req, socket, Buffer.alloc(0));
    return socket;
  }

  it('performs a real upgrade and receives masked audio and PNG messages', async () => {
    const stream = media.register();
    media.bindBot(stream.id, 'bot-1');
    const consumer = jest.fn();
    media.packets(stream.id).subscribe(consumer);
    const socket = upgrade(stream.id, stream.token);
    expect(Buffer.concat(socket.writes).toString()).toContain(
      '101 Switching Protocols',
    );
    socket.push(clientFrame(mediaFixture('audio')));
    socket.push(clientFrame(mediaFixture('video')));
    await new Promise(setImmediate);
    expect(media.status(stream.id)).toMatchObject({
      connections: 1,
      audioPackets: 1,
      videoFrames: 1,
      screenshareFrames: 1,
    });
    expect(consumer.mock.calls[0][0].buffer).toEqual(
      Buffer.from([1, 0, 255, 127]),
    );
    expect(consumer.mock.calls[1][0].buffer).toEqual(TEST_PNG);
  });

  it('rejects an unauthenticated upgrade before reading any media', () => {
    const stream = media.register();
    const socket = upgrade(stream.id, 'invalid');
    expect(Buffer.concat(socket.writes).toString()).toContain(
      '401 Unauthorized',
    );
    expect(media.status(stream.id).connectionCount).toBe(0);
  });

  it('closes a connection that sends a malformed media packet', async () => {
    const stream = media.register();
    const socket = upgrade(stream.id, stream.token);
    socket.push(clientFrame({ event: 'audio_separate_raw.data', data: {} }));
    await new Promise(setImmediate);
    expect(Buffer.concat(socket.writes).toString()).toContain(
      'Invalid media packet',
    );
    expect(media.status(stream.id).audioPackets).toBe(0);
  });

  it('removes its HTTP upgrade listener when the backend shuts down', async () => {
    expect(server.listenerCount('upgrade')).toBe(1);
    await gateway.onModuleDestroy();
    expect(server.listenerCount('upgrade')).toBe(0);
  });
});
