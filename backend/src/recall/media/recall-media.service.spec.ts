import { UnauthorizedException } from '@nestjs/common';
import { RecallMediaService } from './recall-media.service';
import { mediaFixture } from '../../../test/fixtures/recall-media';
import { parseRecallMediaPacket } from './recall-media.packet';

describe('Recall media streams', () => {
  let media: RecallMediaService;
  beforeEach(() => {
    media = new RecallMediaService();
  });
  afterEach(() => media.onModuleDestroy());

  it('authenticates stream-specific tokens without exposing them through status', () => {
    const stream = media.register();
    expect(media.authenticate(stream.id, stream.token)).toBe(stream.id);
    expect(() => media.authenticate(stream.id, 'wrong')).toThrow(
      UnauthorizedException,
    );
    expect(media.status(stream.id)).not.toHaveProperty('token');
    expect(media.status(stream.id)).not.toHaveProperty('packets');
  });

  it('emits decoded audio and video and records arrival counters', () => {
    const stream = media.register();
    media.bindBot(stream.id, 'bot-1');
    const consumer = jest.fn();
    media.packets(stream.id).subscribe(consumer);
    media.ingest(stream.id, parseRecallMediaPacket(mediaFixture('audio')));
    media.ingest(stream.id, parseRecallMediaPacket(mediaFixture('video')));
    expect(consumer).toHaveBeenCalledTimes(2);
    expect(consumer.mock.calls[1][0].buffer).toBeInstanceOf(Buffer);
    expect(media.status(stream.id)).toMatchObject({
      audioPackets: 1,
      audioBytes: 4,
      videoFrames: 1,
      screenshareFrames: 1,
    });
  });

  it('rejects packets from a different bot', () => {
    const stream = media.register();
    media.bindBot(stream.id, 'bot-1');
    expect(() =>
      media.ingest(
        stream.id,
        parseRecallMediaPacket(mediaFixture('audio', 'wrong-bot')),
      ),
    ).toThrow();
    expect(media.status(stream.id).audioPackets).toBe(0);
  });

  it('allows media to arrive before the Create Bot response', () => {
    const stream = media.register();
    media.ingest(stream.id, parseRecallMediaPacket(mediaFixture('audio')));
    media.bindBot(stream.id, 'bot-1');
    expect(media.status(stream.id).botId).toBe('bot-1');
  });

  it('expires disconnected streams after one hour and completes their consumers', () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    const stream = media.register();
    const complete = jest.fn();
    media.packets(stream.id).subscribe({ complete });
    clock.mockReturnValue(60 * 60 * 1000 + 1);
    media.expireInactive();
    expect(complete).toHaveBeenCalled();
    expect(() => media.status(stream.id)).toThrow();
    clock.mockRestore();
  });
});
