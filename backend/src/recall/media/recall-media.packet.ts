export const RECALL_MEDIA_PATH = '/recall/media/';
export const MAX_MEDIA_MESSAGE_BYTES = 4 * 1024 * 1024;

export interface RecallMediaPacket {
  kind: 'audio' | 'video';
  botId: string;
  participant: { id: number; name: string | null };
  timestamp: { absolute: string; relative: number };
  buffer: Buffer;
  videoType?: 'webcam' | 'screenshare';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseRecallMediaPacket(
  payload: unknown,
): RecallMediaPacket | null {
  const body = record(payload);
  if (
    body.event !== 'audio_separate_raw.data' &&
    body.event !== 'video_separate_png.data'
  )
    return null;
  const envelope = record(body.data);
  const data = record(envelope.data);
  const bot = record(envelope.bot);
  const participant = record(data.participant);
  const timestamp = record(data.timestamp);
  if (
    typeof bot.id !== 'string' ||
    !bot.id ||
    !Number.isSafeInteger(participant.id) ||
    (participant.id as number) < 0 ||
    typeof timestamp.absolute !== 'string' ||
    !Number.isFinite(Date.parse(timestamp.absolute)) ||
    typeof timestamp.relative !== 'number' ||
    !Number.isFinite(timestamp.relative) ||
    timestamp.relative < 0 ||
    typeof data.buffer !== 'string' ||
    data.buffer.length > MAX_MEDIA_MESSAGE_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data.buffer)
  ) {
    throw new Error('Invalid Recall media payload');
  }
  const buffer = Buffer.from(data.buffer, 'base64');
  if (
    buffer.toString('base64').replace(/=+$/, '') !==
    data.buffer.replace(/=+$/, '')
  ) {
    throw new Error('Invalid Recall media buffer');
  }
  const audio = body.event === 'audio_separate_raw.data';
  if (audio && buffer.length % 2 !== 0)
    throw new Error('Invalid PCM audio buffer');
  if (
    !audio &&
    (buffer.length < 8 ||
      !buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
      (data.type !== 'webcam' && data.type !== 'screenshare'))
  ) {
    throw new Error('Invalid PNG video frame');
  }
  return {
    kind: audio ? 'audio' : 'video',
    botId: bot.id,
    participant: {
      id: participant.id as number,
      name: typeof participant.name === 'string' ? participant.name : null,
    },
    timestamp: { absolute: timestamp.absolute, relative: timestamp.relative },
    buffer,
    ...(!audio ? { videoType: data.type as 'webcam' | 'screenshare' } : {}),
  };
}
