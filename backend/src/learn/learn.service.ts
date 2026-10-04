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
import { MomentRef, MomentsService } from '../moments/moments.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecallMediaService } from '../recall/media/recall-media.service';
import { RecallMediaPacket } from '../recall/media/recall-media.packet';
import { RecallOutputService } from '../recall/media/recall-output.service';
import {
  ClaudeService,
  ExpertTranscript,
  LearnObservation,
} from './claude.service';
import {
  AgentConversation,
  AgentToolCall,
  ElevenAgentsService,
} from './elevenagents.service';
import {
  interviewerFirstMessage,
  interviewerPrompt,
  tutorFirstMessage,
  tutorPrompt,
} from './agent-prompts';
import { GraphService } from './graph.service';
import { LearnConfiguration } from './learn.configuration';
import { ApprenticeStageError, describeError } from './apprentice-error';
import { redact } from './redact';
import {
  Metrics,
  activityState,
  classifyQuestion,
  latencySummary,
  newMetrics,
} from './session-metrics';

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
function normalized(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
// The vision/knowledge pass runs alongside the conversation; it never speaks.
const OBSERVE_INTERVAL_MS = 1500;
const ALERT_COOLDOWN_MS = 8000;
const AGENT_RETRY_MS = 5000;
// 200 ms of 16 kHz PCM16 silence. Recall sends nothing while the expert is muted, and
// the agent needs a continuous stream to notice that a turn has ended.
const SILENCE = Buffer.alloc(6400);
const MOMENT_GAP_MS = 3000;
// Draft graph updates while the expert talks: at most this often, and only after new knowledge.
const GRAPH_GAP_MS = 25000;
const MAX_MOMENTS = 80;

interface LiveLearn {
  id: string;
  mode: SessionMode;
  savedWorkflow: unknown;
  workflowId: string;
  streamId: string;
  title: string;
  subscription?: Subscription;
  agent?: AgentConversation;
  agentOpening: boolean;
  agentOpens: number;
  agentRetryAt: number;
  silenceTimer?: NodeJS.Timeout;
  lastAudioAt: number;
  firstMediaAt: number;
  moments: MomentRef[];
  lastMomentAt: number;
  replay: Record<string, unknown> | null;
  metrics: Metrics;
  graphDirty: boolean;
  graphBuilding: boolean;
  lastGraphAt: number;
  teachBack: { confirmed: boolean; corrections: string } | null;
  speakerId?: number;
  speakerName: string | null;
  frames: Array<{ png: Buffer; occurredAt: string }>;
  frameHash: string;
  lastFrameAt: number;
  transcripts: ExpertTranscript[];
  transcriptCount: number;
  context: string;
  knowledge: any[];
  said: string[];
  offered: string;
  alerts: string[];
  lastAlertAt: number;
  guidanceCount: number;
  lastGuidance: string | null;
  replyCount: number;
  lastReply: string | null;
  speakingUntil: number;
  offRecord: boolean;
  phase: 'task' | 'debrief' | 'done';
  lastReasonAt: number;
  reasonFailures: number;
  reasonRetryAt: number;
  analysisCount: number;
  lastError: string | null;
  dirty: boolean;
  closing: boolean;
  closed: boolean;
  closedAt: number;
  work?: Promise<void>;
  finalizing?: Promise<void>;
  reasonAbort?: AbortController;
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
    private readonly agents: ElevenAgentsService,
    private readonly media: RecallMediaService,
    private readonly output: RecallOutputService,
    private readonly prisma: PrismaService,
    private readonly momentsStore: MomentsService,
    private readonly graphs: GraphService,
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
        if (state.closing) continue;
        // Join the call as soon as the bot can talk, so Ari greets people like a person would.
        if (
          !state.agent &&
          !state.agentOpening &&
          Date.now() >= state.agentRetryAt &&
          this.output.isReady(state.streamId)
        )
          void this.openAgent(state);
        if (
          state.mode === SessionMode.LEARN &&
          state.graphDirty &&
          !state.graphBuilding &&
          !state.offRecord &&
          state.knowledge.length >= 2 &&
          Date.now() - state.lastGraphAt >= GRAPH_GAP_MS
        )
          void this.buildGraph(state, 'draft');
        if (
          state.work ||
          !state.dirty ||
          state.offRecord ||
          Date.now() < state.reasonRetryAt ||
          Date.now() - state.lastReasonAt < OBSERVE_INTERVAL_MS
        )
          continue;
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
    }, 250);
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
      agentOpening: false,
      agentOpens: 0,
      agentRetryAt: 0,
      lastAudioAt: 0,
      firstMediaAt: 0,
      moments: [],
      lastMomentAt: 0,
      replay: null,
      metrics: newMetrics(),
      graphDirty: false,
      graphBuilding: false,
      lastGraphAt: 0,
      teachBack: null,
      speakerName: null,
      frames: [],
      frameHash: '',
      lastFrameAt: 0,
      transcripts: [],
      transcriptCount: 0,
      context:
        input.mode === SessionMode.TEACH
          ? ''
          : typeof learned.context === 'string'
            ? learned.context
            : '',
      knowledge: Array.isArray(learned.knowledge) ? learned.knowledge : [],
      said: [],
      offered: '',
      alerts: [],
      lastAlertAt: 0,
      guidanceCount: 0,
      lastGuidance: null,
      replyCount: 0,
      lastReply: null,
      speakingUntil: 0,
      offRecord: false,
      phase: 'task',
      lastReasonAt: 0,
      reasonFailures: 0,
      reasonRetryAt: 0,
      analysisCount: 0,
      lastError: null,
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
          this.fail(state, 'Realtime audio ingestion failed');
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
      phase: state.phase,
      offRecord: state.offRecord,
      speakerId: state.speakerId ?? null,
      speakerName: state.speakerName,
      transcriptCount: state.transcriptCount,
      analysisCount: state.analysisCount,
      guidanceCount: state.guidanceCount,
      lastGuidance: state.lastGuidance,
      replay: state.replay,
      activity: activityState({
        ready: !!state.agent?.ready,
        now: Date.now(),
        speakingUntil: state.speakingUntil,
        lastAudioAt: state.lastAudioAt,
        frameChangedAt: state.metrics.frameChangedAt,
      }),
      privacy: state.metrics.privacy,
      questions: state.metrics.questions.slice(-30),
      debrief: {
        planned: state.metrics.debrief.planned,
        asked: state.metrics.debrief.asked,
        confirmed: state.teachBack ? state.teachBack.confirmed : null,
      },
      outcomes: state.metrics.outcomes,
      currentStep: state.metrics.currentStep,
      latency: latencySummary(state.metrics),
      replyCount: state.replyCount,
      lastReply: state.lastReply,
      knowledgeCount: state.knowledge.length,
      voiceReady: !!state.agent?.ready && this.output.isReady(state.streamId),
      speaking: Date.now() < state.speakingUntil,
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
    this.closeAgent(state);
    this.output.cancel(state.streamId);
    this.output.hideImage(state.streamId);
    state.finalizing = this.finalize(state);
    return state.finalizing;
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    this.connections?.unsubscribe();
    await Promise.allSettled([...this.live.keys()].map((id) => this.stop(id)));
  }

  private closeAgent(state: LiveLearn) {
    clearInterval(state.silenceTimer);
    state.agent?.close();
    state.agent = undefined;
  }

  private receive(state: LiveLearn, packet: RecallMediaPacket) {
    if (state.closing) return;
    state.firstMediaAt ||= Date.parse(packet.timestamp.absolute);
    if (packet.kind === 'video' && packet.videoType === 'screenshare') {
      if (state.speakerId !== packet.participant.id)
        this.selectSpeaker(
          state,
          packet.participant.id,
          packet.participant.name,
        );
      // Off the record also means off the screen: no frames are kept or analysed.
      if (state.offRecord || Date.now() - state.lastFrameAt < 1500) return;
      state.lastFrameAt = Date.now();
      const hash = createHash('sha256').update(packet.buffer).digest('hex');
      if (hash === state.frameHash) return;
      state.frameHash = hash;
      state.metrics.frameChangedAt = Date.now();
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
    state.lastAudioAt = Date.now();
    state.agent?.sendAudio(packet.buffer);
  }

  private selectSpeaker(state: LiveLearn, id: number, name: string | null) {
    state.speakerId = id;
    state.speakerName = name;
  }

  private async openAgent(state: LiveLearn) {
    state.agentOpening = true;
    const { learnAgentId, teachAgentId } = this.configuration.get();
    const teaching = state.mode === SessionMode.TEACH;
    try {
      const agent = await this.agents.open(
        teaching ? teachAgentId : learnAgentId,
        {
          prompt: teaching
            ? tutorPrompt(state.title, state.savedWorkflow)
            : interviewerPrompt(state.title),
          firstMessage: state.agentOpens
            ? "Sorry, I dropped off for a second. I'm back, please carry on."
            : teaching
              ? tutorFirstMessage()
              : interviewerFirstMessage(),
        },
        {
          onAudio: (pcm, rate) => {
            // A new utterance: how long after the person stopped talking did Ari start?
            if (
              Date.now() >= state.speakingUntil &&
              state.lastAudioAt &&
              Date.now() - state.lastAudioAt < 15000
            ) {
              const ms = Date.now() - state.lastAudioAt;
              state.metrics.latency.responses = [
                ...state.metrics.latency.responses.slice(-19),
                ms,
              ];
              this.logger.log(
                `Apprentice response latency: session=${state.id} ms=${ms}`,
              );
            }
            state.speakingUntil =
              Math.max(state.speakingUntil, Date.now()) +
              (pcm.length / 2 / rate) * 1000;
            this.output.streamAgentAudio(state.streamId, pcm, rate);
          },
          onInterruption: () => {
            state.speakingUntil = 0;
            this.output.cancel(state.streamId);
          },
          onUserTranscript: (text) => this.heard(state, text),
          onAgentResponse: (text) => this.said(state, text),
          onToolCall: (call) => this.tool(state, call),
          onClose: () => {
            if (state.closing) return;
            this.closeAgent(state);
            state.agentRetryAt = Date.now() + AGENT_RETRY_MS;
            this.fail(state, 'ElevenAgents conversation dropped; reconnecting');
          },
          onError: (message) => this.fail(state, message),
        },
      );
      if (state.closing) return agent.close();
      state.agent = agent;
      state.agentOpens++;
      state.lastError = null;
      state.silenceTimer = setInterval(() => {
        if (Date.now() - state.lastAudioAt >= 180) agent.sendAudio(SILENCE);
      }, 200);
      state.silenceTimer.unref();
      const known = state.knowledge.slice(-30).map((item) => item.statement);
      if (known.length)
        agent.contextualUpdate(
          `[Notes] Already learned so far: ${known.join(' | ')}`,
        );
      if (state.context) agent.contextualUpdate(`[Notes] ${state.context}`);
      this.logger.log(`ElevenAgents connected: session=${state.id}`);
    } catch (error) {
      state.agentRetryAt = Date.now() + AGENT_RETRY_MS;
      this.fail(state, 'Could not start the ElevenAgents conversation', error);
    } finally {
      state.agentOpening = false;
    }
  }

  private heard(state: LiveLearn, text: string) {
    if (state.closed || state.offRecord) return;
    const clean = redact(text.slice(0, 3000));
    state.metrics.privacy.text += clean.count;
    const transcript: ExpertTranscript = {
      id: randomUUID(),
      text: clean.text,
      participantId: state.speakerId ?? 0,
      participantName: state.speakerName,
      occurredAt: new Date().toISOString(),
    };
    state.transcripts = [...state.transcripts.slice(-39), transcript];
    state.transcriptCount++;
    state.dirty = true;
    state.reasonRetryAt = 0;
    this.event(state, 'apprentice.transcript', transcript);
  }

  // Keeps a frame for each meaningful screen change so every Work Map step can show its moment.
  private async captureMoment(
    state: LiveLearn,
    frame: LiveLearn['frames'][number] | undefined,
    caption: string,
    privacy: Pick<LearnObservation, 'personalDataVisible' | 'sensitive'>,
  ) {
    if (
      !frame ||
      state.offRecord ||
      state.moments.length >= MAX_MOMENTS ||
      Date.now() - state.lastMomentAt < MOMENT_GAP_MS
    )
      return undefined;
    // Fail closed: personal data is visible but could not be located, so keep no frame.
    if (privacy.personalDataVisible && !privacy.sensitive.length) {
      state.metrics.privacy.skippedFrames++;
      return undefined;
    }
    state.metrics.privacy.regions += privacy.sensitive.length;
    state.lastMomentAt = Date.now();
    try {
      const moment = await this.momentsStore.capture({
        id: randomUUID(),
        sessionId: state.id,
        workMapId: state.workflowId,
        png: frame.png,
        occurredAt: frame.occurredAt,
        offsetSeconds: Math.max(
          0,
          Math.round(
            (Date.parse(frame.occurredAt) - state.firstMediaAt) / 1000,
          ),
        ),
        caption,
        blur: privacy.sensitive,
      });
      state.moments.push(moment);
      return moment;
    } catch (error) {
      this.fail(state, 'Screen moment could not be saved', error);
      return undefined;
    }
  }

  // The moment on screen when the expert said it: the latest frame at or before the quote.
  private momentFor(state: LiveLearn, at: string | undefined) {
    const time = at ? Date.parse(at) : NaN;
    if (!state.moments.length || !Number.isFinite(time))
      return state.moments.at(-1);
    return (
      [...state.moments]
        .reverse()
        .find((moment) => Date.parse(moment.occurredAt) <= time) ??
      state.moments[0]
    );
  }

  // Labels each question Ari asks (kind, why, grounded in the screen) for the question log
  // and counts the debrief's follow-ups.
  private logQuestion(state: LiveLearn, text: string) {
    if (state.mode !== SessionMode.LEARN || state.phase === 'done') return;
    const label = classifyQuestion(
      text,
      state.metrics.offered,
      state.metrics.recentScreen,
    );
    if (!label) return;
    if (state.phase === 'debrief') state.metrics.debrief.asked++;
    const question = {
      text,
      ...label,
      phase: state.phase,
      momentId: state.moments.at(-1)?.id ?? null,
      screenEvent: state.metrics.recentScreen.at(-1) ?? null,
      at: new Date().toISOString(),
    };
    state.metrics.questions = [...state.metrics.questions.slice(-49), question];
    this.event(state, 'apprentice.question_asked', question);
  }

  private graphNodes(state: LiveLearn): any[] {
    const graph = object(object(state.savedWorkflow).apprentice).graph;
    return Array.isArray(graph?.nodes) ? graph.nodes : [];
  }

  // Per-step progress for the new hire: where they are and how each step went.
  private setOutcome(
    state: LiveLearn,
    nodeId: string,
    status: 'started' | 'correct' | 'needed_help' | 'mistake',
    note: string,
  ) {
    const entry = {
      status,
      note: note.slice(0, 200),
      at: new Date().toISOString(),
    };
    state.metrics.outcomes = { ...state.metrics.outcomes, [nodeId]: entry };
    if (status === 'started') state.metrics.currentStep = nodeId;
    this.event(state, 'apprentice.teach.step', { nodeId, ...entry });
  }

  // Puts the expert's screen moment on the learner's panel, beside the expert's own words.
  private showMoment(state: LiveLearn, item: any, reason: 'tutor' | 'alert') {
    if (!item?.moment) return false;
    state.replay = {
      at: Date.now(),
      reason,
      momentId: item.moment.id,
      knowledgeId: item.id,
      kind: item.kind,
      statement: item.statement,
      quote: item.evidence?.[0]?.text ?? null,
      caption: item.moment.caption,
      offsetSeconds: item.moment.offsetSeconds,
    };
    this.event(state, 'apprentice.teach.replay', state.replay);
    // Also put it on the bot's camera tile so the learner sees it inside the call.
    const { momentId, caption, quote, offsetSeconds } = state.replay as any;
    void this.momentsStore
      .bytes(momentId)
      .then((jpeg) => {
        if (!jpeg || state.closing) return;
        const mins = String(Math.floor(offsetSeconds / 60)).padStart(2, '0');
        const secs = String(offsetSeconds % 60).padStart(2, '0');
        this.output.showImage(state.streamId, {
          jpeg,
          caption: `Expert's screen ${mins}:${secs} · ${caption}`,
          quote,
        });
      })
      .catch((error) => this.fail(state, 'Replay could not be shown', error));
    return true;
  }

  private said(state: LiveLearn, spoken: string) {
    const clean = redact(spoken);
    state.metrics.privacy.text += clean.count;
    const text = clean.text;
    state.lastReply = text;
    state.replyCount++;
    state.said = [...state.said.slice(-11), text];
    this.event(state, 'apprentice.agent_said', {
      text,
      phase: state.phase,
      momentId: state.moments.at(-1)?.id,
    });
    this.logQuestion(state, text);
  }

  private async tool(state: LiveLearn, call: AgentToolCall): Promise<string> {
    const params = object(call.parameters);
    switch (call.name) {
      case 'go_off_record': {
        // The sentence that asked for privacy must not be kept either.
        const last = state.transcripts.at(-1);
        if (last) {
          state.transcripts = state.transcripts.slice(0, -1);
          this.forget(state, last.id);
        }
        state.offRecord = true;
        state.frames = [];
        this.event(state, 'apprentice.off_record', { active: true });
        return 'Off the record. Nothing is being saved. Acknowledge briefly.';
      }
      case 'back_on_record':
        state.offRecord = false;
        state.dirty = true;
        this.event(state, 'apprentice.off_record', { active: false });
        return 'Back on the record.';
      case 'begin_debrief': {
        state.phase = 'debrief';
        state.dirty = true;
        const plan = await this.claude
          .debrief(
            {
              title: state.title,
              context: state.context,
              knowledge: state.knowledge.slice(-60).map((item) => ({
                kind: item.kind,
                statement: item.statement,
              })),
              transcripts: state.transcripts,
            },
            AbortSignal.timeout(20000),
          )
          .catch(() => null);
        state.metrics.debrief.planned = plan?.openQuestions ?? [];
        this.event(state, 'apprentice.debrief.started', { plan });
        if (!plan)
          return 'Ask about any exceptions, limits and who decides when to stop and ask. Then teach the whole process back and ask for corrections.';
        return `Tell them you have ${plan.openQuestions.length} follow-up questions, then ask them one at a time, reacting to each answer:\n${plan.openQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nThen teach it back naturally, in your own words, inviting corrections. Draft: ${plan.teachBack}`;
      }
      case 'confirm_teachback': {
        const confirmed = params.confirmed === true;
        state.phase = 'done';
        state.dirty = true;
        const corrections =
          typeof params.corrections === 'string' ? params.corrections : '';
        state.teachBack = { confirmed, corrections };
        state.graphDirty = true;
        state.lastGraphAt = 0;
        this.event(state, 'apprentice.debrief.teachback', {
          confirmed,
          corrections,
        });
        return confirmed
          ? 'Saved. Thank them warmly and say goodbye.'
          : 'Saved as not yet confirmed. Thank them and say goodbye.';
      }
      case 'step_update': {
        const id = String(params.node_id ?? '');
        const status = String(params.status ?? '');
        if (
          !this.graphNodes(state).some((n: any) => n.id === id) ||
          !['started', 'correct', 'needed_help', 'mistake'].includes(status)
        )
          return 'Unknown step or status. Use a step id from the process outline.';
        this.setOutcome(
          state,
          id,
          status as any,
          typeof params.note === 'string' ? params.note : '',
        );
        return 'ok';
      }
      case 'replay_expert_moment': {
        const item = state.knowledge.find(
          (entry) => entry.id === params.knowledge_id && entry.moment,
        );
        if (!item || !this.showMoment(state, item, 'tutor'))
          return 'No screen moment is saved for that rule. Explain it in words instead.';
        return "The expert's screen moment is now showing on the learner's panel. Tell them you put it up and describe what to look at.";
      }
      case 'finish_lesson': {
        const list = (value: unknown) =>
          Array.isArray(value)
            ? value.filter((item) => typeof item === 'string').slice(0, 12)
            : [];
        this.event(state, 'apprentice.teach.lesson', {
          mastered: list(params.mastered),
          practice: list(params.practice),
        });
        return 'Saved. Wish them well.';
      }
      default:
        return 'Unknown tool';
    }
  }

  // Silent eyes and memory: turns frames and speech into screen events and Work Map
  // knowledge, then hands them to the agent as background. The agent decides when to speak.
  private async observe(state: LiveLearn) {
    const teaching = state.mode === SessionMode.TEACH;
    if (!state.transcripts.length && !state.frames.length) {
      state.dirty = false;
      return;
    }
    state.dirty = false;
    state.lastReasonAt = Date.now();
    const controller = new AbortController();
    state.reasonAbort = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(20000),
    ]);
    const frameHash = state.frameHash;
    const frame = state.frames.at(-1);
    const transcripts = state.transcripts;
    try {
      if (teaching) {
        const result = await this.claude.guide(
          {
            title: state.title,
            savedWorkflow: state.savedWorkflow,
            context: state.context,
            transcripts,
            recentAlerts: state.alerts,
            frames: state.frames,
          },
          signal,
        );
        state.context = result.context;
        state.analysisCount++;
        state.reasonFailures = 0;
        state.lastError = null;
        if (result.screenEvent)
          state.agent?.contextualUpdate(`[Screen] ${result.screenEvent}`);
        const knownIds = new Set(state.knowledge.map((item) => item.id));
        const sourced = result.sourceKnowledgeIds.every((id) =>
          knownIds.has(id),
        );
        const frameAge = frame ? Date.now() - Date.parse(frame.occurredAt) : 0;
        const stale = state.frameHash !== frameHash; // already moved on; reassess
        if (result.alert && stale) state.dirty = true;
        else if (
          result.alert &&
          sourced &&
          state.agent?.ready &&
          Date.now() - state.lastAlertAt >= ALERT_COOLDOWN_MS &&
          !state.alerts.some((a) => normalized(a) === normalized(result.alert))
        ) {
          state.lastAlertAt = Date.now();
          state.alerts = [...state.alerts.slice(-7), result.alert];
          state.guidanceCount++;
          state.lastGuidance = result.alert;
          this.event(state, 'apprentice.teach.alert', {
            alert: result.alert,
            sourceKnowledgeIds: result.sourceKnowledgeIds,
          });
          state.agent.say(`[Alert] ${result.alert}`);
          state.metrics.latency.lastAlertMs = Math.max(0, frameAge);
          this.logger.log(
            `Apprentice alert latency: session=${state.id} frame_to_alert_ms=${state.metrics.latency.lastAlertMs}`,
          );
          // A caught mistake counts against the step it belongs to.
          const node = this.graphNodes(state).find((n: any) =>
            n.knowledgeIds.some((id: string) =>
              result.sourceKnowledgeIds.includes(id),
            ),
          );
          if (node && state.metrics.outcomes[node.id]?.status !== 'correct')
            this.setOutcome(state, node.id, 'mistake', result.alert);
          this.showMoment(
            state,
            state.knowledge.find(
              (item) =>
                result.sourceKnowledgeIds.includes(item.id) && item.moment,
            ),
            'alert',
          );
        }
        return;
      }
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
          recentQuestions: state.said,
          frames: state.frames,
        },
        signal,
      );
      if (controller.signal.aborted) return;
      state.reasonFailures = 0;
      state.lastError = null;
      state.analysisCount++;
      // Defence in depth: nothing personal is kept even if the model copied it.
      const scrub = (text: string) => {
        const clean = redact(text);
        state.metrics.privacy.text += clean.count;
        return clean.text;
      };
      observation.context = scrub(observation.context);
      observation.screenEvent = observation.screenEvent
        ? scrub(observation.screenEvent)
        : null;
      observation.candidateQuestions = observation.candidateQuestions.map(
        (q) => ({ ...q, question: scrub(q.question), why: scrub(q.why) }),
      );
      observation.knowledge = observation.knowledge.map((item) => ({
        ...item,
        statement: scrub(item.statement),
      }));
      state.context = observation.context;
      const agent = state.agent;
      if (observation.screenEvent) {
        state.metrics.recentScreen = [
          ...state.metrics.recentScreen.slice(-4),
          observation.screenEvent,
        ];
        const moment = await this.captureMoment(
          state,
          frame,
          observation.screenEvent,
          observation,
        );
        this.event(state, 'apprentice.screen_event', {
          text: observation.screenEvent,
          occurredAt: frame?.occurredAt,
          momentId: moment?.id,
        });
        agent?.contextualUpdate(`[Screen] ${observation.screenEvent}`);
      }
      const fresh = observation.candidateQuestions.filter(
        (q) =>
          !state.said.some(
            (said) => normalized(said) === normalized(q.question),
          ),
      );
      state.metrics.offered = [...state.metrics.offered, ...fresh].slice(-8);
      const offer = fresh
        .map((q) => `(${q.kind}) ${q.question} [${q.why}]`)
        .join(' | ');
      if (offer && offer !== state.offered) {
        state.offered = offer;
        agent?.contextualUpdate(
          `[Notes] Unexplained so far, ask at a natural pause only if it fits (say how many if more than one): ${offer}`,
        );
      }
      await this.save(state, observation, transcripts);
    } catch (error) {
      state.dirty = true;
      if (!controller.signal.aborted)
        throw new ApprenticeStageError('Claude observation', error);
    } finally {
      state.reasonAbort = undefined;
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
      }))
      .map((item) => ({
        ...item,
        moment: this.momentFor(state, item.evidence[0]?.occurredAt) ?? null,
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
        if (saved.length > state.knowledge.length) state.graphDirty = true;
        state.knowledge = saved;
        return;
      } catch (error) {
        if (error?.code !== 'P2034' || attempt === 2) throw error;
      }
    }
  }

  // Draft graphs update while the expert talks; the last one runs after the debrief.
  private async buildGraph(state: LiveLearn, status: 'draft' | 'confirmed') {
    state.graphBuilding = true;
    state.graphDirty = false;
    state.lastGraphAt = Date.now();
    try {
      const graph = await this.graphs.build(state.workflowId, {
        status,
        debrief: state.teachBack
          ? {
              teachBackConfirmed: state.teachBack.confirmed,
              corrections: state.teachBack.corrections,
            }
          : undefined,
      });
      if (graph)
        this.event(state, 'apprentice.graph', {
          status,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        });
    } catch (error) {
      state.graphDirty = true;
      state.lastGraphAt = Date.now();
      this.fail(state, 'Work Map graph update failed; will retry', error);
    } finally {
      state.graphBuilding = false;
    }
  }

  private async finalize(state: LiveLearn) {
    try {
      await state.work;
      this.event(state, 'apprentice.privacy.summary', state.metrics.privacy);
      if (state.mode === SessionMode.TEACH) {
        this.event(state, 'apprentice.teach.summary', {
          context: state.context,
          guidanceCount: state.guidanceCount,
          transcriptCount: state.transcriptCount,
        });
        await state.events;
        return;
      }
      if (state.phase !== 'done' && state.transcripts.length)
        this.event(state, 'apprentice.debrief.skipped', { phase: state.phase });
      if (state.dirty && !state.offRecord && state.transcripts.length)
        await this.observe(state);
      await state.events;
      await this.save(
        state,
        {
          context: state.context,
          screenEvent: null,
          candidateQuestions: [],
          personalDataVisible: false,
          sensitive: [],
          knowledge: [],
        },
        [],
        true,
      );
      // Final map: confirmed only when the expert confirmed the teach-back.
      if (state.knowledge.length)
        await this.buildGraph(
          state,
          state.phase === 'done' && state.teachBack?.confirmed
            ? 'confirmed'
            : 'draft',
        );
      await state.events;
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

  // Removes a transcript the expert asked to keep off the record.
  private forget(state: LiveLearn, transcriptId: string) {
    state.events = state.events
      .then(async () => {
        await this.prisma.sessionEvent.deleteMany({
          where: {
            sessionId: state.id,
            type: 'apprentice.transcript',
            payload: { path: ['id'], equals: transcriptId },
          },
        });
      })
      .catch((error) =>
        this.fail(
          state,
          'Off-the-record transcript could not be removed',
          error,
        ),
      );
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
