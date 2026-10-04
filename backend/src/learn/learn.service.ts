import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Subscription } from 'rxjs';
import { Prisma } from '../generated/prisma/client';
import { SessionMode, WorkflowStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { RecallMediaService } from '../recall/media/recall-media.service';
import { RecallMediaPacket } from '../recall/media/recall-media.packet';
import { RecallOutputService } from '../recall/media/recall-output.service';
import {
  ClaudeService,
  ExpertTranscript,
  LearnObservation,
  TeachObservation,
} from './claude.service';
import { ElevenLabsService, TranscriptionStream } from './elevenlabs.service';
import { LearnConfiguration } from './learn.configuration';
import { ApprenticeStageError, describeError } from './apprentice-error';

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
function normalized(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
// Scribe already waits for silence before committing; only debounce adjacent commits here.
const TURN_SETTLE_MS = 120;

interface LiveLearn {
  id: string;
  mode: SessionMode;
  savedWorkflow: unknown;
  workflowId: string;
  streamId: string;
  title: string;
  subscription?: Subscription;
  speech?: TranscriptionStream;
  speakerId?: number;
  speakerName: string | null;
  frames: Array<{ png: Buffer; occurredAt: string }>;
  frameHash: string;
  lastFrameAt: number;
  transcripts: ExpertTranscript[];
  transcriptCount: number;
  pausePending: boolean;
  voiceWasReady: boolean;
  partial: string;
  context: string;
  knowledge: any[];
  pendingQuestion: string | null;
  questionAt: number;
  recentQuestions: string[];
  lastTranscriptAt: number;
  activeSpeech: string;
  echoUntil: number;
  replyCount: number;
  lastReply: string | null;
  lastReasonAt: number;
  lastReasonTranscriptCount: number;
  lastLatency: {
    schedulingMs: number;
    responseMs: number;
    firstAudioMs?: number;
    playbackStartedMs?: number;
  } | null;
  reasonFailures: number;
  reasonRetryAt: number;
  lastError: string | null;
  analysisCount: number;
  guidanceCount: number;
  lastGuidance: string | null;
  language: string | null;
  lastGuidanceAt: number;
  guideRetryAt: number;
  answeredTranscriptIds: Set<string>;
  dirty: boolean;
  closing: boolean;
  closed: boolean;
  closedAt: number;
  work?: Promise<void>;
  finalizing?: Promise<void>;
  reasonAbort?: AbortController;
  voiceAbort?: AbortController;
  events: Promise<void>;
  disconnect?: NodeJS.Timeout;
}

@Injectable()
export class LearnService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LearnService.name);
  private readonly live = new Map<string, LiveLearn>();
  private timer?: NodeJS.Timeout;
  private connections?: Subscription;

  constructor(
    private readonly configuration: LearnConfiguration,
    private readonly claude: ClaudeService,
    private readonly eleven: ElevenLabsService,
    private readonly media: RecallMediaService,
    private readonly output: RecallOutputService,
    private readonly prisma: PrismaService,
  ) {}

  assertConfigured() {
    this.configuration.get();
  }

  onModuleInit() {
    this.connections = this.media.connectionEvents.subscribe((event) => {
      const state = [...this.live.values()].find(
        (item) => item.streamId === event.streamId && !item.closing,
      );
      if (!state) return;
      clearTimeout(state.disconnect);
      if (!event.connected) {
        state.disconnect = setTimeout(() => {
          void this.stop(state.id).catch(() =>
            this.fail(state, 'Could not finalize apprentice session'),
          );
        }, 30000);
        state.disconnect.unref();
      }
    });
    this.timer = setInterval(() => {
      for (const state of this.live.values()) {
        if (state.closed) {
          if (Date.now() - state.closedAt > 30 * 60 * 1000)
            this.live.delete(state.id);
          continue;
        }
        if (!state.closing && !state.work) {
          const ready = this.output.isReady(state.streamId);
          if (ready && !state.voiceWasReady) state.dirty = true;
          state.voiceWasReady = ready;
          if (state.guideRetryAt && Date.now() >= state.guideRetryAt) {
            state.guideRetryAt = 0;
            state.dirty = true;
          }
          if (
            state.pausePending &&
            !state.partial &&
            Date.now() - state.lastTranscriptAt >= TURN_SETTLE_MS
          )
            state.dirty = true;
          if (state.pendingQuestion && Date.now() - state.questionAt > 90000) {
            this.event(state, 'apprentice.question_unanswered', {
              question: state.pendingQuestion,
            });
            state.pendingQuestion = null;
            state.dirty = true;
          }
        }
        if (
          state.closing ||
          state.work ||
          !!state.partial ||
          !state.dirty ||
          Date.now() < state.reasonRetryAt ||
          (state.transcriptCount <= state.lastReasonTranscriptCount &&
            Date.now() - state.lastReasonAt < 2500) ||
          Date.now() - state.lastTranscriptAt < TURN_SETTLE_MS
        )
          continue;
        if (
          !state.partial &&
          Date.now() - state.lastTranscriptAt >= TURN_SETTLE_MS
        )
          state.pausePending = false;
        state.work = this.observe(state)
          .catch((error) => {
            state.reasonFailures++;
            state.reasonRetryAt =
              Date.now() +
              Math.min(30000, 2500 * 2 ** Math.min(state.reasonFailures, 4));
            this.fail(state, 'Live apprentice update failed; retrying', error);
          })
          .finally(() => {
            state.work = undefined;
          });
      }
    }, 100);
    this.timer.unref();
  }

  start(input: {
    sessionId: string;
    workflowId: string;
    streamId: string;
    title: string;
    definition: unknown;
    mode?: SessionMode;
  }) {
    this.assertConfigured();
    if (this.live.has(input.sessionId)) return;
    const learned = object(object(input.definition).apprentice);
    const state: LiveLearn = {
      id: input.sessionId,
      mode: input.mode ?? SessionMode.LEARN,
      savedWorkflow: input.definition,
      workflowId: input.workflowId,
      streamId: input.streamId,
      title: input.title,
      speakerName: null,
      frames: [],
      frameHash: '',
      lastFrameAt: 0,
      transcripts: [],
      transcriptCount: 0,
      pausePending: false,
      voiceWasReady: false,
      partial: '',
      context:
        input.mode === SessionMode.TEACH
          ? ''
          : typeof learned.context === 'string'
            ? learned.context
            : '',
      knowledge: Array.isArray(learned.knowledge) ? learned.knowledge : [],
      pendingQuestion: null,
      questionAt: 0,
      recentQuestions: [],
      lastTranscriptAt: 0,
      activeSpeech: '',
      echoUntil: 0,
      replyCount: 0,
      lastReply: null,
      lastReasonAt: 0,
      lastReasonTranscriptCount: 0,
      lastLatency: null,
      reasonFailures: 0,
      reasonRetryAt: 0,
      lastError: null,
      analysisCount: 0,
      guidanceCount: 0,
      lastGuidance: null,
      language: null,
      lastGuidanceAt: 0,
      guideRetryAt: 0,
      answeredTranscriptIds: new Set(),
      dirty: false,
      closing: false,
      closed: false,
      closedAt: 0,
      events: Promise.resolve(),
    };
    this.live.set(state.id, state);
    state.subscription = this.media.packets(input.streamId).subscribe({
      next: (packet) => {
        try {
          this.receive(state, packet);
        } catch {
          this.fail(state, 'Realtime speech ingestion failed');
        }
      },
      complete: () => {
        void this.stop(state.id).catch(() =>
          this.fail(state, 'Could not finalize apprentice session'),
        );
      },
    });
    this.logger.log(
      `Apprentice observing: session=${state.id} mode=${state.mode}`,
    );
  }

  status(id: string) {
    const state = this.live.get(id);
    if (!state)
      throw new NotFoundException('No live apprentice state for this session');
    return {
      active: !state.closed && !state.closing,
      finalizing: state.closing && !state.closed,
      finalized: state.closed,
      mode: state.mode,
      speakerId: state.speakerId ?? null,
      speakerName: state.speakerName,
      transcriptCount: state.transcriptCount,
      analysisCount: state.analysisCount,
      guidanceCount: state.guidanceCount,
      lastGuidance: state.lastGuidance,
      replyCount: state.replyCount,
      lastReply: state.lastReply,
      lastLatency: state.lastLatency,
      language: state.language,
      knowledgeCount: state.knowledge.length,
      pendingQuestion: state.pendingQuestion,
      voiceReady: this.output.isReady(state.streamId),
      speaking: !!state.voiceAbort,
      context: state.context,
      lastError: state.lastError,
    };
  }

  stop(id: string) {
    const state = this.live.get(id);
    if (!state || state.closed) return Promise.resolve();
    if (state.finalizing) return state.finalizing;
    state.closing = true;
    clearTimeout(state.disconnect);
    state.subscription?.unsubscribe();
    state.reasonAbort?.abort();
    state.voiceAbort?.abort();
    this.output.cancel(state.streamId);
    state.finalizing = this.finalize(state);
    return state.finalizing;
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    this.connections?.unsubscribe();
    await Promise.allSettled([...this.live.keys()].map((id) => this.stop(id)));
  }

  private receive(state: LiveLearn, packet: RecallMediaPacket) {
    if (state.closing) return;
    if (packet.kind === 'video' && packet.videoType === 'screenshare') {
      if (state.speakerId !== packet.participant.id)
        this.selectSpeaker(
          state,
          packet.participant.id,
          packet.participant.name,
        );
      if (Date.now() - state.lastFrameAt < 1500) return;
      state.lastFrameAt = Date.now();
      const hash = createHash('sha256').update(packet.buffer).digest('hex');
      if (hash === state.frameHash) return;
      state.frameHash = hash;
      state.frames = [
        ...state.frames.slice(-1),
        { png: packet.buffer, occurredAt: packet.timestamp.absolute },
      ];
      state.dirty = true;
    }
    if (packet.kind !== 'audio' || !packet.buffer.length) return;
    if (state.speakerId === undefined)
      this.selectSpeaker(state, packet.participant.id, packet.participant.name);
    if (packet.participant.id !== state.speakerId) return;
    state.speech?.write(packet.buffer);
  }

  private selectSpeaker(state: LiveLearn, id: number, name: string | null) {
    state.speech?.close();
    state.speakerId = id;
    state.speakerName = name;
    state.partial = '';
    state.speech = this.eleven.transcribe(
      (text, committed) => {
        if (
          state.closed ||
          state.speakerId !== id ||
          (state.closing && !committed)
        )
          return;
        const clean = text.trim().slice(0, 3000);
        if (!clean) {
          state.partial = '';
          state.pausePending = true;
          return;
        }
        const spoken = normalized(state.activeSpeech);
        const heard = normalized(clean);
        if (
          spoken &&
          (state.voiceAbort || Date.now() < state.echoUntil) &&
          (heard === spoken ||
            (!committed && heard.length >= 15 && spoken.startsWith(heard)))
        ) {
          // Suppressed committed bot echo must still finish the partial STT turn.
          state.partial = '';
          state.pausePending = true;
          return;
        }
        state.lastTranscriptAt = Date.now();
        if (!committed) {
          state.partial = clean;
          state.dirty = true;
          return;
        }
        state.partial = '';
        const transcript: ExpertTranscript = {
          id: randomUUID(),
          text: clean,
          participantId: id,
          participantName: name,
          occurredAt: new Date().toISOString(),
        };
        state.transcripts = [...state.transcripts.slice(-39), transcript];
        state.transcriptCount++;
        if (state.reasonAbort && !state.voiceAbort && !state.closing) {
          // Replace reasoning about an unfinished/older turn with this committed utterance.
          state.reasonAbort.abort();
        }
        if (state.voiceAbort) {
          // A real participant reply interrupts Ari in either mode.
          state.voiceAbort.abort();
          this.output.cancel(state.streamId);
        }
        state.pausePending = true;
        state.dirty = true;
        this.event(state, 'apprentice.transcript', transcript);
      },
      () =>
        this.fail(
          state,
          'ElevenLabs realtime transcription unavailable; reconnecting',
        ),
    );
  }

  private mayAsk(state: LiveLearn) {
    return (
      !state.closing &&
      !state.pendingQuestion &&
      Date.now() - state.questionAt > 45000 &&
      this.mayCoach(state)
    );
  }

  private async observe(state: LiveLearn) {
    if (state.mode === SessionMode.TEACH) return this.guide(state);
    const transcripts = state.transcripts.filter(
      (item) => item.participantId === state.speakerId,
    );
    if (!transcripts.length && !state.frames.length) return;
    state.dirty = false;
    state.lastReasonAt = Date.now();
    state.lastReasonTranscriptCount = state.transcriptCount;
    const controller = new AbortController();
    state.reasonAbort = controller;
    const transcriptCount = state.transcriptCount;
    let voiceWork: Promise<void> | undefined;
    let stage = 'Claude reasoning';
    try {
      const observation = await this.claude.observe(
        {
          title: state.title,
          context: state.context,
          knowledge: state.knowledge.slice(-60).map((item) => ({
            id: item.id,
            kind: item.kind,
            statement: item.statement,
          })),
          transcripts,
          partialTranscript: state.partial,
          pendingQuestion: state.pendingQuestion,
          recentQuestions: state.recentQuestions.slice(-8),
          frames: state.frames,
          mayAsk: this.mayAsk(state),
          mayRespond: this.mayCoach(state),
          answeredTranscriptIds: [...state.answeredTranscriptIds],
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        (speech, ids) => {
          const allowedIds = new Set(transcripts.map((item) => item.id));
          const freshIds = [...new Set(ids)].filter(
            (id) => allowedIds.has(id) && !state.answeredTranscriptIds.has(id),
          );
          if (
            controller.signal.aborted ||
            state.transcriptCount !== transcriptCount ||
            !this.mayCoach(state) ||
            !freshIds.length
          )
            return;
          voiceWork = this.reply(state, speech, freshIds).catch((error) =>
            this.fail(state, 'Voice reply failed', error),
          );
        },
      );
      if (controller.signal.aborted) {
        state.dirty = true;
        return;
      }
      // Persist incrementally alongside voice, so a database write does not delay the reply.
      const persistence = this.save(state, observation, transcripts).then(
        () => ({ error: undefined as unknown }),
        (error: unknown) => ({ error }),
      );
      state.context = observation.context;
      state.reasonFailures = 0;
      if (!voiceWork) state.reasonRetryAt = 0;
      state.analysisCount++;
      if (!voiceWork) state.lastError = null;
      if (
        state.pendingQuestion &&
        observation.answerResolved &&
        transcripts.some(
          (item) => Date.parse(item.occurredAt) > state.questionAt,
        )
      ) {
        this.event(state, 'apprentice.answer', {
          question: state.pendingQuestion,
          transcriptIds: transcripts
            .filter((item) => Date.parse(item.occurredAt) > state.questionAt)
            .map((item) => item.id),
        });
        state.pendingQuestion = null;
      }
      try {
        if (voiceWork) {
          await voiceWork;
          return;
        }
        const transcriptIds = new Set(transcripts.map((item) => item.id));
        observation.respondsToTranscriptIds = [
          ...new Set(observation.respondsToTranscriptIds),
        ].filter(
          (id) => transcriptIds.has(id) && !state.answeredTranscriptIds.has(id),
        );
        if (
          state.transcriptCount !== transcriptCount ||
          !this.mayCoach(state)
        ) {
          if (observation.response || observation.question)
            state.pausePending = true;
        } else if (
          observation.response &&
          observation.respondsToTranscriptIds.length
        ) {
          await this.reply(
            state,
            observation.response,
            observation.respondsToTranscriptIds,
          );
        } else if (
          !observation.response &&
          observation.question &&
          this.mayAsk(state) &&
          !state.recentQuestions.some(
            (item) => normalized(item) === normalized(observation.question),
          )
        ) {
          await this.ask(state, observation.question);
        }
      } finally {
        stage = 'Work Map knowledge save';
        const saved = await persistence;
        if (saved.error !== undefined) throw saved.error;
      }
    } catch (error) {
      state.dirty = true;
      if (!controller.signal.aborted)
        throw new ApprenticeStageError(stage, error);
    } finally {
      await voiceWork;
      state.reasonAbort = undefined;
    }
  }

  private mayCoach(state: LiveLearn) {
    return (
      !state.closing &&
      !state.partial &&
      Date.now() - state.lastTranscriptAt >= TURN_SETTLE_MS &&
      this.output.isReady(state.streamId)
    );
  }

  private async guide(state: LiveLearn) {
    const transcripts = state.transcripts.filter(
      (item) => item.participantId === state.speakerId,
    );
    if (!transcripts.length && !state.frames.length) return;
    state.dirty = false;
    state.lastReasonAt = Date.now();
    state.lastReasonTranscriptCount = state.transcriptCount;
    const controller = new AbortController();
    state.reasonAbort = controller;
    const transcriptCount = state.transcriptCount;
    const frameHash = state.frameHash;
    let voiceWork: Promise<void> | undefined;
    try {
      const observation = await this.claude.guide(
        {
          title: state.title,
          savedWorkflow: state.savedWorkflow,
          context: state.context,
          transcripts,
          partialTranscript: state.partial,
          frames: state.frames,
          recentSpeech: state.recentQuestions,
          answeredTranscriptIds: [...state.answeredTranscriptIds],
          maySpeak: this.mayCoach(state),
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        (speech) => {
          if (controller.signal.aborted) return;
          state.language = speech.language || state.language;
          voiceWork = this.deliverGuidance(
            state,
            speech,
            transcripts,
            transcriptCount,
            frameHash,
          ).catch((error) => this.fail(state, 'Voice guidance failed', error));
        },
      );
      if (controller.signal.aborted) return;
      state.context = observation.context;
      state.language = observation.language || state.language;
      state.analysisCount++;
      state.reasonFailures = 0;
      if (!voiceWork) {
        state.reasonRetryAt = 0;
        state.lastError = null;
        await this.deliverGuidance(
          state,
          observation,
          transcripts,
          transcriptCount,
          frameHash,
        );
      }
    } catch (error) {
      state.dirty = true;
      if (!controller.signal.aborted)
        throw new ApprenticeStageError('Claude coaching', error);
    } finally {
      await voiceWork;
      state.reasonAbort = undefined;
    }
  }

  private async deliverGuidance(
    state: LiveLearn,
    observation: TeachObservation,
    transcripts: ExpertTranscript[],
    transcriptCount: number,
    frameHash: string,
  ) {
    if (!observation.speech) return;
    // A correction based on an old screen may already have been fixed.
    if (
      observation.category === 'correction' &&
      state.frameHash !== frameHash
    ) {
      state.dirty = true;
      return;
    }
    // New employee speech invalidates the reply being generated; reason again.
    if (state.transcriptCount !== transcriptCount || !this.mayCoach(state)) {
      state.pausePending = true;
      state.dirty = true;
      return;
    }
    const transcriptIds = new Set(transcripts.map((item) => item.id));
    observation.respondsToTranscriptIds = [
      ...new Set(observation.respondsToTranscriptIds),
    ].filter((id) => transcriptIds.has(id));
    const freshReply = observation.respondsToTranscriptIds.some(
      (id) => !state.answeredTranscriptIds.has(id),
    );
    if (
      !freshReply &&
      state.recentQuestions
        .slice(-8)
        .some((item) => normalized(item) === normalized(observation.speech!))
    )
      return;
    if (
      observation.category === 'answer' &&
      (!observation.respondsToTranscriptIds.length ||
        observation.respondsToTranscriptIds.every((id) =>
          state.answeredTranscriptIds.has(id),
        ))
    )
      return;
    const knownIds = new Set(state.knowledge.map((item) => item.id));
    // Reject fabricated references rather than presenting them as expert-backed advice.
    if (observation.sourceKnowledgeIds.some((id) => !knownIds.has(id))) return;
    if (
      observation.category === 'correction' &&
      state.knowledge.length &&
      !observation.sourceKnowledgeIds.length
    )
      return;
    const cooldown = observation.category === 'guidance' ? 10000 : 3000;
    if (!freshReply && Date.now() - state.lastGuidanceAt < cooldown) {
      state.guideRetryAt = state.lastGuidanceAt + cooldown;
      return;
    }
    await this.coach(state, observation);
  }

  private playSpeech(state: LiveLearn, speech: string, signal: AbortSignal) {
    const committedAt = state.lastTranscriptAt || state.lastReasonAt;
    const latency: NonNullable<LiveLearn['lastLatency']> = {
      schedulingMs: Math.max(0, state.lastReasonAt - committedAt),
      responseMs: Date.now() - state.lastReasonAt,
    };
    state.lastLatency = latency;
    return this.output.play(
      state.streamId,
      this.eleven.speak(speech, signal),
      signal,
      {
        onFirstAudio: () => {
          latency.firstAudioMs = Date.now() - committedAt;
        },
        onPlaybackStarted: () => {
          latency.playbackStartedMs = Date.now() - committedAt;
          this.logger.log(
            `Apprentice voice latency: session=${state.id} scheduling_ms=${latency.schedulingMs} response_ms=${latency.responseMs} first_audio_ms=${latency.firstAudioMs ?? 'pending'} playback_started_ms=${latency.playbackStartedMs}`,
          );
        },
      },
    );
  }

  private async coach(state: LiveLearn, observation: TeachObservation) {
    const speech = observation.speech!;
    const controller = new AbortController();
    state.voiceAbort = controller;
    state.activeSpeech = speech;
    state.recentQuestions = [...state.recentQuestions.slice(-19), speech];
    const payload = {
      speech,
      category: observation.category,
      language: state.language,
      sourceKnowledgeIds: observation.sourceKnowledgeIds,
      respondsToTranscriptIds: observation.respondsToTranscriptIds,
    };
    this.event(state, 'apprentice.teach.speech', {
      ...payload,
      delivery: 'started',
    });
    try {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(25000),
      ]);
      await this.playSpeech(state, speech, signal);
      state.lastGuidance = speech;
      state.lastGuidanceAt = Date.now();
      state.guidanceCount++;
      state.lastError = null;
      for (const id of observation.respondsToTranscriptIds)
        state.answeredTranscriptIds.add(id);
      // Only the recent transcript window is sent to Claude; keep tracking bounded too.
      const recentIds = new Set(state.transcripts.map((item) => item.id));
      for (const id of state.answeredTranscriptIds)
        if (!recentIds.has(id)) state.answeredTranscriptIds.delete(id);
      this.event(state, 'apprentice.teach.speech_delivered', payload);
      this.logger.log(`Apprentice guidance spoken: session=${state.id}`);
    } catch (error) {
      state.recentQuestions = state.recentQuestions.filter(
        (item) => item !== speech,
      );
      this.event(
        state,
        controller.signal.aborted
          ? 'apprentice.teach.speech_interrupted'
          : 'apprentice.teach.speech_failed',
        payload,
      );
      state.dirty = true;
      if (!controller.signal.aborted) state.reasonRetryAt = Date.now() + 5000;
      if (!controller.signal.aborted)
        this.fail(
          state,
          'Voice guidance failed; check Recall output and ElevenLabs credentials',
          error,
        );
    } finally {
      state.voiceAbort = undefined;
      state.echoUntil = Date.now() + 3000;
    }
  }

  private async reply(
    state: LiveLearn,
    speech: string,
    transcriptIds: string[],
  ) {
    const controller = new AbortController();
    state.voiceAbort = controller;
    state.activeSpeech = speech;
    state.recentQuestions = [...state.recentQuestions.slice(-19), speech];
    const payload = { speech, respondsToTranscriptIds: transcriptIds };
    this.event(state, 'apprentice.reply', { ...payload, delivery: 'started' });
    this.logger.log(`Apprentice reply started: session=${state.id}`);
    try {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(25000),
      ]);
      await this.playSpeech(state, speech, signal);
      state.lastReply = speech;
      state.replyCount++;
      state.lastError = null;
      for (const id of transcriptIds) state.answeredTranscriptIds.add(id);
      const recentIds = new Set(state.transcripts.map((item) => item.id));
      for (const id of state.answeredTranscriptIds)
        if (!recentIds.has(id)) state.answeredTranscriptIds.delete(id);
      this.event(state, 'apprentice.reply_delivered', payload);
      this.logger.log(`Apprentice reply spoken: session=${state.id}`);
    } catch (error) {
      state.recentQuestions = state.recentQuestions.filter(
        (item) => item !== speech,
      );
      state.dirty = true;
      this.event(
        state,
        controller.signal.aborted
          ? 'apprentice.reply_interrupted'
          : 'apprentice.reply_failed',
        payload,
      );
      if (!controller.signal.aborted) {
        state.guideRetryAt = Date.now() + 5000;
        state.reasonRetryAt = state.guideRetryAt;
        this.fail(
          state,
          'Voice reply failed; check Recall output and ElevenLabs credentials',
          error,
        );
      }
    } finally {
      state.voiceAbort = undefined;
      state.echoUntil = Date.now() + 3000;
    }
  }

  private async ask(state: LiveLearn, question: string) {
    const controller = new AbortController();
    const previousQuestionAt = state.questionAt;
    state.voiceAbort = controller;
    state.activeSpeech = question;
    state.pendingQuestion = question;
    state.questionAt = Date.now();
    state.recentQuestions = [...state.recentQuestions.slice(-19), question];
    this.event(state, 'apprentice.question', { question, delivery: 'started' });
    try {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(25000),
      ]);
      await this.playSpeech(state, question, signal);
      this.event(state, 'apprentice.question_delivered', { question });
      state.lastError = null;
      this.logger.log(`Apprentice question spoken: session=${state.id}`);
    } catch (error) {
      state.pendingQuestion = null;
      state.questionAt = previousQuestionAt;
      state.recentQuestions = state.recentQuestions.filter(
        (item) => item !== question,
      );
      state.dirty = true;
      state.guideRetryAt = Date.now() + 5000;
      if (!controller.signal.aborted) state.reasonRetryAt = state.guideRetryAt;
      this.event(state, 'apprentice.question_failed', { question });
      if (!controller.signal.aborted)
        this.fail(
          state,
          'Voice output failed; check Recall output and ElevenLabs credentials',
          error,
        );
    } finally {
      state.voiceAbort = undefined;
      state.echoUntil = Date.now() + 3000;
    }
  }

  private async save(
    state: LiveLearn,
    observation: LearnObservation,
    transcripts: ExpertTranscript[],
    finish = false,
  ) {
    const evidence = new Map(transcripts.map((item) => [item.id, item]));
    const kinds = new Set([
      'step',
      'decision',
      'rule',
      'exception',
      'threshold',
      'warning',
    ]);
    const items = observation.knowledge
      .filter(
        (item) =>
          item &&
          kinds.has(item.kind) &&
          typeof item.statement === 'string' &&
          item.statement.trim() &&
          Array.isArray(item.evidenceTranscriptIds) &&
          item.evidenceTranscriptIds.length &&
          item.evidenceTranscriptIds.every((id) => evidence.has(id)),
      )
      .map((item) => ({
        id: createHash('sha256')
          .update(`${item.kind}:${normalized(item.statement)}`)
          .digest('hex')
          .slice(0, 24),
        kind: item.kind,
        statement: item.statement.trim().slice(0, 1000),
        evidence: [...new Set(item.evidenceTranscriptIds)].map((id) =>
          evidence.get(id),
        ),
        sessionId: state.id,
        learnedAt: new Date().toISOString(),
      }));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const saved = await this.prisma.$transaction(
          async (tx) => {
            const workflow = await tx.workMap.findUniqueOrThrow({
              where: { id: state.workflowId },
            });
            const definition = object(workflow.definition),
              previous = object(definition.apprentice);
            const knowledge = new Map<string, any>(
              (Array.isArray(previous.knowledge) ? previous.knowledge : []).map(
                (item) => [item.id, item],
              ),
            );
            for (const item of items) {
              if (knowledge.has(item.id)) continue;
              knowledge.set(item.id, item);
              await tx.sessionEvent.upsert({
                where: { deliveryId: `learn:knowledge:${state.id}:${item.id}` },
                create: {
                  sessionId: state.id,
                  deliveryId: `learn:knowledge:${state.id}:${item.id}`,
                  type: 'apprentice.knowledge',
                  payload: item as Prisma.InputJsonValue,
                  occurredAt: new Date(),
                },
                update: {},
              });
            }
            await tx.workMap.update({
              where: { id: state.workflowId },
              data: {
                definition: {
                  ...definition,
                  apprentice: {
                    ...previous,
                    version: 1,
                    context: observation.context,
                    knowledge: [...knowledge.values()],
                    updatedAt: new Date().toISOString(),
                  },
                } as Prisma.InputJsonValue,
                ...(finish && knowledge.size
                  ? { status: WorkflowStatus.READY }
                  : {}),
              },
            });
            return [...knowledge.values()];
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        state.context = observation.context;
        state.knowledge = saved;
        return;
      } catch (error) {
        if (error?.code !== 'P2034' || attempt === 2) throw error;
      }
    }
  }

  private async finalize(state: LiveLearn) {
    try {
      await state.speech?.finish();
      await state.work;
      if (state.mode === SessionMode.TEACH) {
        this.event(state, 'apprentice.teach.summary', {
          context: state.context,
          language: state.language,
          guidanceCount: state.guidanceCount,
          transcriptCount: state.transcriptCount,
        });
        await state.events;
        return;
      }
      if (state.dirty && (state.transcripts.length || state.frames.length))
        await this.observe(state);
      await state.events;
      await this.save(
        state,
        {
          context: state.context,
          knowledge: [],
          question: null,
          answerResolved: false,
          response: null,
          respondsToTranscriptIds: [],
        },
        [],
        true,
      );
    } catch (error) {
      this.fail(
        state,
        'Apprentice finalization failed; previously saved events and knowledge are retained',
        error,
      );
    } finally {
      state.frames = [];
      state.closed = true;
      state.closedAt = Date.now();
      this.logger.log(
        `Apprentice stopped: session=${state.id} knowledge=${state.knowledge.length}`,
      );
    }
  }

  private event(state: LiveLearn, type: string, payload: unknown) {
    state.events = state.events
      .then(async () => {
        await this.prisma.sessionEvent.create({
          data: {
            sessionId: state.id,
            deliveryId: `${state.mode.toLowerCase()}:${randomUUID()}`,
            type,
            payload: payload as Prisma.InputJsonValue,
            occurredAt: new Date(),
          },
        });
      })
      .catch((error) =>
        this.fail(state, 'Apprentice event could not be saved', error),
      );
  }

  private fail(state: LiveLearn, message: string, error?: unknown) {
    if (error !== undefined) message += `: ${describeError(error)}`;
    if (state.lastError !== message)
      this.logger.warn(`${message}: session=${state.id}`);
    state.lastError = message;
  }
}
