import { mediaFixture, TEST_PNG } from '../../../test/fixtures/recall-media';
import { parseRecallMediaPacket } from './recall-media.packet';

describe('Recall media payload decoding', () => {
  it('decodes separate participant PCM audio with timestamps and speaker identity', () => {
    const packet = parseRecallMediaPacket(mediaFixture('audio'));
    expect(packet).toMatchObject({
      kind: 'audio',
      botId: 'bot-1',
      participant: { id: 7, name: 'Expert' },
      timestamp: { relative: 1.5 },
    });
    expect(packet.buffer).toEqual(Buffer.from([1, 0, 255, 127]));
  });

  it('decodes screen-share PNG frames', () => {
    const packet = parseRecallMediaPacket(mediaFixture('video'));
    expect(packet.videoType).toBe('screenshare');
    expect(packet.buffer).toEqual(TEST_PNG);
  });

  it('distinguishes webcam frames and accepts an unnamed participant', () => {
    const message = mediaFixture('video');
    message.data.data.type = 'webcam';
    const packet = parseRecallMediaPacket({
      ...message,
      data: {
        ...message.data,
        data: { ...message.data.data, participant: { id: 7, name: null } },
      },
    });
    expect(packet.videoType).toBe('webcam');
    expect(packet.participant).toEqual({ id: 7, name: null });
  });

  it('accepts empty silent audio packets', () => {
    const message = mediaFixture('audio');
    message.data.data.buffer = '';
    expect(parseRecallMediaPacket(message).buffer.length).toBe(0);
  });

  it('ignores events not requested by this pipeline', () => {
    expect(parseRecallMediaPacket({ event: 'transcript.data' })).toBeNull();
  });

  it.each(['not-base64!', 'a', 'AQ=='])(
    'rejects malformed or odd-length audio: %s',
    (buffer) => {
      const message = mediaFixture('audio');
      message.data.data.buffer = buffer;
      expect(() => parseRecallMediaPacket(message)).toThrow();
    },
  );

  it('rejects a video payload that is not PNG', () => {
    const message = mediaFixture('video');
    message.data.data.buffer = Buffer.from('not a PNG').toString('base64');
    expect(() => parseRecallMediaPacket(message)).toThrow();
  });
});
