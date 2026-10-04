// Evidence for the Apprentice Test: when Ari asks, what it asks and why, whether the
// debrief closed its gaps, and whether the new hire learned. Kept apart from LearnService.
import type { CandidateQuestion } from './claude.service';

export type QuestionKind =
  'reason' | 'guardrail' | 'threshold' | 'exception' | 'followup';

export type AskedQuestion = {
  text: string;
  kind: QuestionKind;
  why: string;
  grounded: boolean;
  phase: 'task' | 'debrief';
  momentId: string | null;
  screenEvent: string | null;
  at: string;
};

export type StepOutcome = {
  status: 'started' | 'correct' | 'needed_help' | 'mistake';
  note: string;
  at: string;
};

export type Metrics = {
  frameChangedAt: number;
  privacy: { text: number; regions: number; skippedFrames: number };
  questions: AskedQuestion[];
  recentScreen: string[];
  offered: CandidateQuestion[];
  debrief: { planned: string[]; asked: number };
  outcomes: Record<string, StepOutcome>;
  currentStep: string | null;
  latency: { responses: number[]; lastAlertMs: number | null };
};

export const newMetrics = (): Metrics => ({
  frameChangedAt: 0,
  privacy: { text: 0, regions: 0, skippedFrames: 0 },
  questions: [],
  recentScreen: [],
  offered: [],
  debrief: { planned: [], asked: 0 },
  outcomes: {},
  currentStep: null,
  latency: { responses: [], lastAlertMs: null },
});

const GUARDRAIL =
  /\b(stop|ask someone|escalat|never|limit|approv|allowed|permission|maximum|cap|who decides|controller|manager)/i;
const THRESHOLD =
  /\b(over|under|above|below|more than|less than|threshold|how much|amount)\b/i;
const EXCEPTION =
  /\b(exception|every|always|only for|unless|except|special case)\b/i;

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4 || /\d/.test(word)),
  );

function overlap(a: string, b: string) {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / Math.min(left.size, right.size);
}

// Deterministic on purpose: it labels what Ari said without another model call.
export function classifyQuestion(
  text: string,
  candidates: CandidateQuestion[],
  recentScreen: string[],
): Pick<AskedQuestion, 'kind' | 'why' | 'grounded'> | null {
  if (!text.includes('?')) return null;
  const match = candidates
    .map((candidate) => ({
      candidate,
      score: overlap(text, candidate.question),
    }))
    .filter((entry) => entry.score >= 0.4)
    .sort((a, b) => b.score - a.score)[0]?.candidate;
  const screen = recentScreen.find((line) => overlap(text, line) >= 0.2);
  const kind: QuestionKind =
    match?.kind ??
    (GUARDRAIL.test(text)
      ? 'guardrail'
      : THRESHOLD.test(text)
        ? 'threshold'
        : EXCEPTION.test(text)
          ? 'exception'
          : /\bwhy|what made|reason|because\b/i.test(text)
            ? 'reason'
            : 'followup');
  return {
    kind,
    why: match?.why || screen || '',
    grounded: !!match || !!screen,
  };
}

export type Activity =
  'connecting' | 'speaking' | 'talking' | 'screen_active' | 'pause';

// What Ari is waiting on right now: the visible answer to "how does it know when to ask?".
export function activityState(input: {
  ready: boolean;
  now: number;
  speakingUntil: number;
  lastAudioAt: number;
  frameChangedAt: number;
}): Activity {
  if (!input.ready) return 'connecting';
  if (input.now < input.speakingUntil) return 'speaking';
  if (input.now - input.lastAudioAt < 1200) return 'talking';
  if (input.now - input.frameChangedAt < 2500) return 'screen_active';
  return 'pause';
}

export function latencySummary(metrics: Metrics) {
  const samples = metrics.latency.responses;
  return {
    samples: samples.length,
    lastResponseMs: samples.at(-1) ?? null,
    avgResponseMs: samples.length
      ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      : null,
    lastAlertMs: metrics.latency.lastAlertMs,
  };
}
