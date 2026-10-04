import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Subject } from 'rxjs';
import { RecallMediaPacket } from './recall-media.packet';

interface MediaStream {
  id: string;
  token: string;
  botId: string | null;
  creationFailed: boolean;
  connections: number;
  connectionCount: number;
  audioPackets: number;
  videoFrames: number;
  screenshareFrames: number;
  audioBytes: number;
  videoBytes: number;
  lastActivityAt: number;
  lastPacketAt: string | null;
  packets: Subject<RecallMediaPacket>;
}

@Injectable()
export class RecallMediaService implements OnModuleDestroy {
  readonly connectionEvents = new Subject<{
    streamId: string;
    connected: boolean;
  }>();
  private readonly logger = new Logger(RecallMediaService.name);
  private readonly streams = new Map<string, MediaStream>();

  register() {
    this.expireInactive();
    if (this.streams.size >= 100)
      throw new ServiceUnavailableException('Media stream capacity reached');
    const stream: MediaStream = {
      id: randomUUID(),
      token: randomBytes(32).toString('hex'),
      botId: null,
      creationFailed: false,
      connections: 0,
      connectionCount: 0,
      audioPackets: 0,
      videoFrames: 0,
      screenshareFrames: 0,
      audioBytes: 0,
      videoBytes: 0,
      lastActivityAt: Date.now(),
      lastPacketAt: null,
      packets: new Subject<RecallMediaPacket>(),
    };
    this.streams.set(stream.id, stream);
    return { id: stream.id, token: stream.token };
  }

  discard(id: string) {
    this.streams.get(id)?.packets.complete();
    this.streams.delete(id);
  }

  creationFailed(id: string) {
    this.get(id).creationFailed = true;
  }

  bindBot(id: string, botId: string) {
    const stream = this.get(id);
    if (stream.botId && stream.botId !== botId)
      throw new Error('Recall bot does not match this media stream');
    stream.botId = botId;
  }

  authenticate(id: string, token: string) {
    const stream = this.streams.get(id);
    const provided = Buffer.from(token);
    const expected = Buffer.from(stream?.token ?? '');
    if (
      !stream ||
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new UnauthorizedException('Invalid media stream credentials');
    }
    return id;
  }

  connected(id: string) {
    const stream = this.get(id);
    stream.connections++;
    stream.connectionCount++;
    stream.lastActivityAt = Date.now();
    this.logger.log(`Recall media connected: stream=${id}`);
    this.connectionEvents.next({ streamId: id, connected: true });
  }

  disconnected(id: string) {
    const stream = this.streams.get(id);
    if (!stream) return;
    stream.connections = Math.max(0, stream.connections - 1);
    stream.lastActivityAt = Date.now();
    this.logger.log(`Recall media disconnected: stream=${id}`);
    if (!stream.connections)
      this.connectionEvents.next({ streamId: id, connected: false });
  }

  end(id: string) {
    this.streams.get(id)?.packets.complete();
  }

  ingest(id: string, packet: RecallMediaPacket) {
    const stream = this.get(id);
    this.bindBot(id, packet.botId);
    stream.lastActivityAt = Date.now();
    stream.lastPacketAt = packet.timestamp.absolute;
    if (packet.kind === 'audio') {
      stream.audioPackets++;
      stream.audioBytes += packet.buffer.length;
    } else {
      stream.videoFrames++;
      stream.videoBytes += packet.buffer.length;
      if (packet.videoType === 'screenshare') stream.screenshareFrames++;
    }
    const firstPacket =
      packet.kind === 'audio'
        ? stream.audioPackets === 1
        : stream.videoFrames === 1;
    if (firstPacket)
      this.logger.log(
        `Recall ${packet.kind} received: stream=${id} participant=${packet.participant.id} bytes=${packet.buffer.length}${packet.videoType ? ` type=${packet.videoType}` : ''}`,
      );
    // Deliver decoded buffers to backend consumers without retaining a recording.
    stream.packets.next(packet);
  }

  packets(id: string) {
    return this.get(id).packets.asObservable();
  }

  status(id: string) {
    const stream = this.get(id);
    return {
      streamId: stream.id,
      botId: stream.botId,
      creationFailed: stream.creationFailed,
      connections: stream.connections,
      connectionCount: stream.connectionCount,
      audioPackets: stream.audioPackets,
      videoFrames: stream.videoFrames,
      screenshareFrames: stream.screenshareFrames,
      audioBytes: stream.audioBytes,
      videoBytes: stream.videoBytes,
      lastPacketAt: stream.lastPacketAt,
      lastActivityAt: new Date(stream.lastActivityAt).toISOString(),
    };
  }

  expireInactive() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const stream of this.streams.values()) {
      if (!stream.connections && stream.lastActivityAt < cutoff)
        this.discard(stream.id);
    }
  }

  onModuleDestroy() {
    for (const id of this.streams.keys()) this.discard(id);
    this.connectionEvents.complete();
  }

  private get(id: string) {
    const stream = this.streams.get(id);
    if (!stream) throw new NotFoundException('Media stream not found');
    return stream;
  }
}
