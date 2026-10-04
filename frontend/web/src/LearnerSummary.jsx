import { useSessionQuery, useWorkflowQuery } from './api.js'
import { useSessionEvents } from './session-events.js'
import {
  ErrorNotice,
  Loading,
  buttonClass,
  secondaryClass,
  statusLabel,
  isTerminal,
} from './ui.jsx'

export default function LearnerSummary({ workflowId, sessionId, user, go }) {
  const args = { workflowId, sessionId }
  const session = useSessionQuery(args, { pollingInterval: 5000 })
  const workflow = useWorkflowQuery(workflowId, { pollingInterval: 5000 })
  const feed = useSessionEvents(args, 5000)
  if (session.isLoading) return <Loading>Loading session…</Loading>
  if (session.error)
    return (
      <div className="p-6">
        <ErrorNotice error={session.error} retry={session.refetch} />
      </div>
    )
  const s = session.data
  const teach = s.mode === 'TEACH'
  const summary = [...feed.items]
    .reverse()
    .find((e) => e.type === 'apprentice.teach.summary')?.payload
  const delivered = feed.items.filter(
    (e) => e.type === 'apprentice.teach.speech_delivered',
  )
  const corrections = delivered.filter(
    (e) => e.payload?.category === 'correction',
  )
  const facts = feed.items.filter((e) => e.type === 'apprentice.knowledge')
  const context =
    summary?.context ||
    (!teach && workflow.data?.definition?.apprentice?.context)
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 md:p-8">
      <div>
        <div className="text-xs text-zinc-500">
          {teach ? 'Employee Teach' : 'Expert Learn'} session
        </div>
        <h1 className="mt-1 text-3xl font-semibold">
          {workflow.data?.title || 'Session summary'}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {user.name} · {new Date(s.createdAt).toLocaleString()} ·{' '}
          {statusLabel(s.status)}
        </p>
      </div>
      <ErrorNotice
        error={workflow.error || feed.error}
        retry={() => {
          workflow.refetch()
          feed.refetch()
        }}
      />
      <ErrorNotice message={s.error} />
      {teach && !summary && isTerminal(s.status) && (
        <p className="text-sm text-zinc-500">
          The closing summary will appear when finalization finishes, if the
          session ran in this backend process.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          [
            'Transcript entries',
            summary?.transcriptCount ??
              feed.items.filter((e) => e.type === 'apprentice.transcript')
                .length,
          ],
          [
            teach ? 'Spoken guidance' : 'Knowledge saved',
            summary?.guidanceCount ?? (teach ? delivered.length : facts.length),
          ],
          [
            teach ? 'Corrections shown' : 'Workflow status',
            teach ? corrections.length : statusLabel(workflow.data?.status),
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl border border-line bg-panel p-5"
          >
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="mt-1 text-3xl font-semibold">{value}</div>
          </div>
        ))}
      </div>
      {context && (
        <section className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">
            {teach ? 'Progress from this session' : 'Saved expert context'}
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-600">
            {context}
          </p>
        </section>
      )}
      <section className="rounded-2xl border border-line bg-panel p-5">
        <h2 className="text-sm font-semibold">
          {teach ? 'Advice from Ari' : 'Knowledge captured in this session'}
        </h2>
        <ul className="mt-3 divide-y divide-line">
          {(teach ? delivered : facts).map((e) => (
            <li key={e.id} className="py-3 text-sm">
              <span className="mr-2 text-xs capitalize text-glow">
                {e.payload.category || e.payload.kind}
              </span>
              {e.payload.speech || e.payload.statement}
            </li>
          ))}
        </ul>
        {!(teach ? delivered : facts).length && (
          <p className="mt-3 text-sm text-zinc-500">
            No saved entries in the loaded history.
          </p>
        )}
        {feed.cursor && (
          <button
            className={`${secondaryClass} mt-4`}
            disabled={feed.loadingOlder}
            onClick={feed.loadOlder}
          >
            {feed.loadingOlder ? 'Loading…' : 'Load earlier history'}
          </button>
        )}
      </section>
      {feed.cursor && (
        <p className="text-xs text-zinc-500">
          Counts without a closing summary reflect loaded history. Load earlier
          history to see more.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          className={buttonClass}
          onClick={() => go({ name: 'map', workflowId })}
        >
          Open Work Map
        </button>
        <button
          className={secondaryClass}
          onClick={() => go({ name: 'live', workflowId, sessionId })}
        >
          View conversation
        </button>
        <button className={secondaryClass} onClick={() => go({ name: 'home' })}>
          Back to dashboard
        </button>
      </div>
    </div>
  )
}
