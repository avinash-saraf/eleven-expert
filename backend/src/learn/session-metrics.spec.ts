import { activityState, classifyQuestion } from './session-metrics';

const candidates = [
  {
    question: 'Is there a point where you would stop and ask someone?',
    kind: 'guardrail' as const,
    why: 'invoice over 5000 recoded, no limit stated',
  },
];

describe('classifyQuestion', () => {
  it('ignores statements', () => {
    expect(classifyQuestion('Got it, thanks.', candidates, [])).toBeNull();
  });

  it('inherits kind and reason from a matching candidate', () => {
    const result = classifyQuestion(
      'Is there a point where you would stop and ask someone about this one?',
      candidates,
      [],
    );
    expect(result).toEqual({
      kind: 'guardrail',
      why: 'invoice over 5000 recoded, no limit stated',
      grounded: true,
    });
  });

  it('labels an unmatched question and grounds it in the screen', () => {
    const result = classifyQuestion(
      'Why did you change the cost center to 0400?',
      [],
      ['Invoice 4471 cost center changed from 4711 to 0400'],
    );
    expect(result?.kind).toBe('reason');
    expect(result?.grounded).toBe(true);
  });

  it('marks a generic question as not grounded', () => {
    expect(
      classifyQuestion('So how is your day going?', [], [])?.grounded,
    ).toBe(false);
  });
});

describe('activityState', () => {
  const base = {
    ready: true,
    now: 100_000,
    speakingUntil: 0,
    lastAudioAt: 0,
    frameChangedAt: 0,
  };
  it('waits while the person talks or the screen changes, then allows a question', () => {
    expect(activityState({ ...base, lastAudioAt: 99_500 })).toBe('talking');
    expect(activityState({ ...base, frameChangedAt: 99_000 })).toBe(
      'screen_active',
    );
    expect(activityState(base)).toBe('pause');
    expect(activityState({ ...base, speakingUntil: 101_000 })).toBe('speaking');
    expect(activityState({ ...base, ready: false })).toBe('connecting');
  });
});
