import { BadRequestException } from '@nestjs/common';
import { SessionStatus } from '../generated/prisma/enums';

export interface RecallLifecycleEvent {
  type: string;
  botId: string;
  sessionId?: string;
  mediaStreamId?: string;
  code: string;
  subCode?: string;
  occurredAt: Date;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseRecallEvent(
  payload: unknown,
): RecallLifecycleEvent | null {
  const body = object(payload);
  if (typeof body.event !== 'string' || !body.event.startsWith('bot.'))
    return null;
  const data = object(body.data);
  const legacy = body.event === 'bot.status_change';
  const bot = object(data.bot);
  const details = object(legacy ? data.status : data.data);
  const botId = legacy ? data.bot_id : bot.id;
  const code = legacy ? details.code : (details.code ?? body.event.slice(4));
  const timestamp = legacy ? details.created_at : details.updated_at;
  // Log/breakout events have their own shapes and are not lifecycle updates.
  if (!legacy && !LIFECYCLE_CODES.has(body.event.slice(4))) return null;
  if (
    typeof botId !== 'string' ||
    !botId ||
    typeof code !== 'string' ||
    !code ||
    typeof timestamp !== 'string' ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new BadRequestException('Invalid Recall lifecycle event');
  }
  if (!legacy && code !== body.event.slice(4)) {
    throw new BadRequestException('Recall event and status code do not match');
  }
  const metadata = object(bot.metadata);
  return {
    type: body.event,
    botId,
    code,
    subCode:
      typeof details.sub_code === 'string' ? details.sub_code : undefined,
    sessionId:
      typeof metadata.session_id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        metadata.session_id,
      )
        ? metadata.session_id
        : undefined,
    mediaStreamId:
      typeof metadata.media_stream_id === 'string'
        ? metadata.media_stream_id
        : undefined,
    occurredAt: new Date(timestamp),
  };
}

const LIFECYCLE_CODES = new Set([
  'joining_call',
  'in_waiting_room',
  'in_call_not_recording',
  'recording_permission_allowed',
  'recording_permission_denied',
  'in_call_recording',
  'call_ended',
  'done',
  'fatal',
]);

const STATUS_BY_CODE: Record<string, SessionStatus> = {
  joining_call: SessionStatus.JOINING,
  in_waiting_room: SessionStatus.WAITING_ROOM,
  in_call_not_recording: SessionStatus.IN_CALL,
  in_call_recording: SessionStatus.RECORDING,
  call_ended: SessionStatus.ENDED,
  done: SessionStatus.COMPLETED,
  fatal: SessionStatus.FAILED,
};

export function nextSessionStatus(current: SessionStatus, code: string) {
  const next = recallSessionStatus(code);
  if (code === 'fatal') return SessionStatus.FAILED;
  if (
    !next ||
    current === SessionStatus.FAILED ||
    current === SessionStatus.COMPLETED
  )
    return current;
  const terminal = [
    SessionStatus.ENDED,
    SessionStatus.COMPLETED,
    SessionStatus.FAILED,
  ] as SessionStatus[];
  if (
    (current === SessionStatus.STOPPING || current === SessionStatus.ENDED) &&
    !terminal.includes(next)
  )
    return current;
  return next;
}

export function recallSessionStatus(code: string): SessionStatus | undefined {
  return Object.prototype.hasOwnProperty.call(STATUS_BY_CODE, code)
    ? STATUS_BY_CODE[code]
    : undefined;
}
