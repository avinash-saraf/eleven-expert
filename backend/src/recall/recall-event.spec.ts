import { BadRequestException } from '@nestjs/common';
import { SessionStatus } from '../generated/prisma/enums';
import { nextSessionStatus, parseRecallEvent } from './recall-event';

describe('Recall lifecycle events', () => {
  it('normalizes modern lifecycle events and session metadata', () => {
    const event = parseRecallEvent({
      event: 'bot.in_call_recording',
      data: {
        bot: {
          id: 'bot-1',
          metadata: { session_id: 'db95c70a-e045-4311-8d71-130b36d17062' },
        },
        data: { code: 'in_call_recording', updated_at: '2026-10-03T12:00:00Z' },
      },
    });
    expect(event).toMatchObject({
      botId: 'bot-1',
      code: 'in_call_recording',
      sessionId: 'db95c70a-e045-4311-8d71-130b36d17062',
    });
    expect(event.occurredAt.toISOString()).toBe('2026-10-03T12:00:00.000Z');
  });

  it('supports the legacy status_change payload', () => {
    expect(
      parseRecallEvent({
        event: 'bot.status_change',
        data: {
          bot_id: 'bot-1',
          status: {
            code: 'fatal',
            sub_code: 'google_meet_sign_in_failed',
            created_at: '2026-10-03T12:00:00Z',
          },
        },
      }),
    ).toMatchObject({
      botId: 'bot-1',
      code: 'fatal',
      subCode: 'google_meet_sign_in_failed',
    });
  });

  it('ignores unrelated and future event types', () => {
    expect(parseRecallEvent({ event: 'transcript.done' })).toBeNull();
    expect(parseRecallEvent({ event: 'bot.new_feature' })).toBeNull();
  });

  it('rejects malformed lifecycle events', () => {
    expect(() => parseRecallEvent({ event: 'bot.done', data: {} })).toThrow(
      BadRequestException,
    );
  });

  it.each([
    [SessionStatus.JOINING, 'in_waiting_room', SessionStatus.WAITING_ROOM],
    [SessionStatus.RECORDING, 'in_call_not_recording', SessionStatus.IN_CALL],
    [SessionStatus.STOPPING, 'in_call_recording', SessionStatus.STOPPING],
    [SessionStatus.ENDED, 'in_waiting_room', SessionStatus.ENDED],
    [SessionStatus.ENDED, 'done', SessionStatus.COMPLETED],
    [SessionStatus.RECORDING, 'fatal', SessionStatus.FAILED],
    [SessionStatus.FAILED, 'done', SessionStatus.FAILED],
    [SessionStatus.COMPLETED, 'fatal', SessionStatus.FAILED],
    [SessionStatus.COMPLETED, 'joining_call', SessionStatus.COMPLETED],
    [SessionStatus.RECORDING, 'future_status', SessionStatus.RECORDING],
  ])('maps %s + %s to %s', (current, code, expected) => {
    expect(nextSessionStatus(current, code)).toBe(expected);
  });
});
