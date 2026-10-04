import { useEffect, useRef, useState } from 'react'
import {
  useSessionQuery,
  useWorkflowQuery,
  useMediaQuery,
  useApprenticeQuery,
  useStopSessionMutation,
} from './api.js'
import {
  ErrorNotice,
  Loading,
  buttonClass,
  secondaryClass,
  isTerminal,
  statusLabel,
  knowledgeOf,
} from './ui.jsx'
import { useSessionEvents, visibleEvents } from './session-events.js'
import InviteCard from './InviteCard.jsx'
import Face from './Face.jsx'
import ExpertReplay from './ExpertReplay.jsx'
import WorkGraph from './WorkGraph.jsx'
import {
  ActivityChip,
  DebriefChecklist,
  LatencyPanel,
  Mastery,
  PrivacyPanel,
  QuestionLog,
} from './ApprenticeEvidence.jsx'

export default function SessionLive({ workflowId, sessionId, user, go }) {
  const args = { workflowId, sessionId }
  const session = useSessionQuery(args, { pollingInterval: 2000 })
  const workflow = useWorkflowQuery(workflowId, { pollingInterval: 5000 })
  const media = useMediaQuery(args, {
    skip: !session.data?.streamId,
    pollingInterval: 2000,
  })
  const apprentice = useApprenticeQuery(args, {
    skip: !session.data?.streamId,
    pollingInterval: 2000,
  })
  const feed = useSessionEvents(args)
  const [stopSession, stop] = useStopSessionMutation()
  const [stopRequested, setStopRequested] = useState(false)
  const end = useRef(null)
  const events = visibleEvents(feed.items)
  const lesson = [...feed.items]
    .reverse()
    .find((e) => e.type === 'apprentice.teach.lesson')?.payload
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [feed.items.length])
  async function finish() {
    try {
      await stopSession(args).unwrap()
      setStopRequested(true)
      await Promise.all([
        session.refetch(),
        workflow.refetch(),
        apprentice.refetch(),
        feed.refetch(),
      ])
    } catch {
      /* Stop errors appear below. */
    }
  }
  if (session.isLoading) return <Loading>Getting your session…</Loading>
  if (session.error)
    return (
      <div className="space-y-4 p-6">
        <ErrorNotice error={session.error} retry={session.refetch} />
        <button className={secondaryClass} onClick={() => go({ name: 'home' })}>
          Back to dashboard
        </button>
      </div>
    )
  const s = session.data
  const w = workflow.data
  const a = apprentice.data
  const graph = w?.definition?.apprentice?.graph
  const finished = isTerminal(s.status) || a?.finalized || stopRequested
  const joined =
    ['IN_CALL', 'RECORDING'].includes(s.status) || !!media.data?.connections
  const teach = s.mode === 'TEACH'
  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_360px]">
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button
              onClick={() => go({ name: 'home' })}
              className="text-xs text-zinc-500"
            >
              ← Dashboard
            </button>
            <h1 className="mt-2 text-2xl font-semibold">
              {w?.title || 'Meeting session'}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {teach ? 'Employee Teach Mode' : 'Expert Learn Mode'} ·{' '}
              {statusLabel(s.status)}
            </p>
          </div>
          <a
            className={secondaryClass}
            href={s.meetingUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Meet ↗
          </a>
        </div>
        <ErrorNotice error={workflow.error} retry={workflow.refetch} />
        <ErrorNotice message={s.error || a?.lastError} />
        {!joined && !finished && s.status !== 'STOPPING' && (
          <InviteCard meetingUrl={s.meetingUrl} status={s.status} />
        )}
        {a?.finalizing && (
          <p
            role="status"
            className="rounded-xl border border-line bg-panel p-4 text-sm"
          >
            Saving the final session context…
          </p>
        )}
        {(joined || finished) && (
          <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
            <section className="rounded-2xl border border-line bg-panel p-4">
              <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                {teach
                  ? 'Expert knowledge'
                  : 'Knowledge learned in this workflow'}
              </h2>
              <div className="mt-3 space-y-2">
                {knowledgeOf(w)
                  .slice(-12)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-line p-3 text-sm"
                    >
                      <span className="mr-2 text-xs capitalize text-glow">
                        {item.kind}
                      </span>
                      {item.statement}
                    </div>
                  ))}
                {!knowledgeOf(w).length && (
                  <p className="text-sm text-zinc-500">
                    Knowledge appears as the expert explains the workflow.
                  </p>
                )}
              </div>
            </section>
            <div className="space-y-3">
              <div className="grid place-items-center rounded-2xl border border-line bg-panel p-4">
                <Face
                  state={
                    a?.speaking ? 'speaking' : a?.active ? 'listening' : 'idle'
                  }
                  size={110}
                />
                <span className="mt-2 text-xs text-zinc-500">Ari</span>
              </div>
              <div className="space-y-2 rounded-2xl border border-line bg-panel p-3 text-xs">
                <div className="flex justify-between">
                  <span>Voice</span>
                  <span>{a?.voiceReady ? 'Ready' : 'Connecting'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Audio packets</span>
                  <span>{media.data?.audioPackets ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Screen frames</span>
                  <span>{media.data?.screenshareFrames ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>{teach ? 'Spoken guidance' : 'Knowledge items'}</span>
                  <span>
                    {teach
                      ? (a?.guidanceCount ?? '—')
                      : (a?.knowledgeCount ?? '—')}
                  </span>
                </div>
                {a?.language && (
                  <div className="flex justify-between">
                    <span>Language</span>
                    <span>{a.language}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {(joined || finished) && a?.active && (
          <div className="flex flex-wrap items-center gap-3">
            <ActivityChip activity={a?.activity} />
            <LatencyPanel latency={a?.latency} />
          </div>
        )}
        {teach && graph?.nodes?.length > 0 && (
          <WorkGraph
            graph={graph}
            currentId={a?.currentStep}
            outcomes={a?.outcomes}
            height="h-[300px]"
          />
        )}
        {teach && <Mastery graph={graph} outcomes={a?.outcomes} />}
        {!teach && (
          <>
            <QuestionLog questions={a?.questions} />
            <DebriefChecklist debrief={a?.debrief} phase={a?.phase} />
          </>
        )}
        <PrivacyPanel privacy={a?.privacy} offRecord={a?.offRecord} />
        {teach && <ExpertReplay workflowId={workflowId} replay={a?.replay} />}
        {teach && lesson && (
          <section className="rounded-2xl border border-line bg-panel p-4">
            <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Your lesson result
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Mastered</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {(lesson.mastered || []).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold">Practice next</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {(lesson.practice || []).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}
        {a?.pendingQuestion && (
          <section className="rounded-2xl border border-glow/40 bg-glow/5 p-4">
            <h2 className="text-xs uppercase text-glow">Ari asks</h2>
            <p className="mt-2 text-sm">{a.pendingQuestion}</p>
            <p className="mt-2 text-xs text-zinc-500">
              Answer aloud inside Google Meet.
            </p>
          </section>
        )}
        {!teach && a?.lastReply && (
          <section className="rounded-2xl border border-glow/40 bg-glow/5 p-4">
            <h2 className="text-xs uppercase text-glow">Ari’s latest answer</h2>
            <p className="mt-2 text-sm">{a.lastReply}</p>
          </section>
        )}
        {teach && a?.lastGuidance && (
          <section className="rounded-2xl border border-glow/40 bg-glow/5 p-4">
            <h2 className="text-xs uppercase text-glow">
              Ari’s latest guidance
            </h2>
            <p className="mt-2 text-sm">{a.lastGuidance}</p>
          </section>
        )}
        {a?.context && (
          <section className="rounded-2xl border border-line bg-panel p-4">
            <h2 className="text-xs uppercase text-zinc-500">
              {teach ? 'Current progress' : 'Live workflow context'}
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">
              {a.context}
            </p>
          </section>
        )}
        <ErrorNotice error={media.error} retry={media.refetch} />
        {apprentice.error && (
          <ErrorNotice error={apprentice.error} retry={apprentice.refetch} />
        )}
        <ErrorNotice error={stop.error} />
        <div className="flex flex-wrap gap-3">
          {!finished && (
            <button
              disabled={stop.isLoading || !s.botId}
              onClick={finish}
              className={buttonClass}
            >
              {stop.isLoading
                ? 'Stopping and saving…'
                : s.status === 'STOPPING'
                  ? 'Check and finalize session'
                  : 'Stop Ari & save session'}
            </button>
          )}
          {(finished || s.status === 'STOPPING') && (
            <button
              className={buttonClass}
              onClick={() => go({ name: 'summary', workflowId, sessionId })}
            >
              View session summary →
            </button>
          )}
          <button
            className={secondaryClass}
            onClick={() => go({ name: 'map', workflowId })}
          >
            Open Work Map
          </button>
        </div>
        {finished && !teach && (
          <p className="text-sm text-zinc-500">
            {w?.status === 'READY'
              ? 'Your workflow is READY for employees.'
              : 'Your workflow remains a draft until learning finishes with confirmed knowledge.'}
          </p>
        )}
        <p className="text-xs text-zinc-500">
          Screen sharing and voice conversation happen inside Google Meet.
          Returning to the dashboard keeps the bot in the call.
        </p>
      </div>
      <aside className="flex min-h-[320px] flex-col border-t border-line lg:border-l lg:border-t-0">
        <div className="border-b border-line p-4 text-xs uppercase tracking-wider text-zinc-500">
          Live conversation & knowledge
        </div>
        <div className="max-h-[calc(100vh-130px)] flex-1 space-y-3 overflow-y-auto p-4">
          {feed.cursor && (
            <button
              disabled={feed.loadingOlder}
              onClick={feed.loadOlder}
              className={`${secondaryClass} w-full`}
            >
              {feed.loadingOlder ? 'Loading…' : 'Load earlier conversation'}
            </button>
          )}
          <ErrorNotice error={feed.error} retry={feed.refetch} />
          {!events.length && (
            <p className="text-sm text-zinc-500">
              {feed.isLoading
                ? 'Loading conversation…'
                : 'Speak inside Meet; real transcript and AI responses will appear here.'}
            </p>
          )}
          {events.map((event) => (
            <div key={event.id} className="fade-up text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span>{event.display.who}</span>
                <span
                  className={`rounded-full px-2 py-0.5 capitalize ${event.display.failed || event.display.category === 'correction' ? 'bg-red-50 text-red-700' : 'bg-zinc-100'}`}
                >
                  {event.display.category}
                </span>
                <time>{new Date(event.occurredAt).toLocaleTimeString()}</time>
              </div>
              <p
                className={
                  event.display.who === 'Ari'
                    ? 'rounded-xl bg-panel px-3 py-2 text-zinc-800'
                    : 'text-zinc-600'
                }
              >
                {event.display.text}
              </p>
              {event.display.delivery && (
                <span className="text-xs text-zinc-500">
                  {event.display.delivery}
                </span>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>
      </aside>
    </div>
  )
}
