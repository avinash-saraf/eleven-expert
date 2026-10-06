import { useWorkflowsQuery, useSessionsQuery } from './api.js'
import {
  ErrorNotice,
  Loading,
  buttonClass,
  secondaryClass,
  knowledgeOf,
  statusLabel,
  isTerminal,
} from './ui.jsx'
import Face from './Face.jsx'
import KnowledgeAtRisk from './KnowledgeAtRisk.jsx'

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{hint}</div>
    </div>
  )
}

export default function Dashboard({ user, go }) {
  const {
    data: workflows = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useWorkflowsQuery(undefined, {
    pollingInterval: 5000,
    skipPollingIfUnfocused: true,
  })
  const expert = user.role === 'expert'
  const ready = workflows.filter((w) => w.status === 'READY')
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-zinc-500">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Welcome, {user.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {expert
              ? 'Teach Ari your workflow, then let your team learn from it.'
              : 'Choose a workflow your expert has taught Ari.'}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className={secondaryClass}
            onClick={refetch}
            disabled={isFetching}
          >
            Refresh
          </button>
          {expert && (
            <button className={buttonClass} onClick={() => go({ name: 'new' })}>
              + New workflow
            </button>
          )}
        </div>
      </div>
      {expert ? (
        <KnowledgeAtRisk workflows={workflows} user={user} go={go} />
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-6 rounded-3xl bg-zinc-900 p-6 text-white md:p-8">
          <div className="max-w-xl">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">
              {user.organization.name}
            </div>
            <h2 className="mt-3 text-2xl font-semibold">
              {expert
                ? 'Your experience becomes the team’s knowledge.'
                : 'An expert coworker, inside your Google Meet.'}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              {expert
                ? 'Share your screen, explain your decisions, and answer Ari’s questions. Learned knowledge is saved throughout the call and made available when the session finishes.'
                : 'Ari watches your shared screen, listens to your questions, and coaches you using your expert’s saved knowledge. Ask it to explain in your language.'}
            </p>
          </div>
          <Face state="idle" size={110} />
        </section>
      )}
      <ErrorNotice error={error} retry={refetch} />
      {isLoading ? (
        <Loading>Loading workflows…</Loading>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Workflows"
              value={workflows.length}
              hint={expert ? 'In your organization' : 'Available for training'}
            />
            <Stat
              label="Ready to teach"
              value={ready.length}
              hint="Expert learning completed"
            />
            <Stat
              label="Saved knowledge"
              value={workflows.reduce((n, w) => n + knowledgeOf(w).length, 0)}
              hint="Steps, decisions, rules and exceptions"
            />
          </div>
          <section>
            <h2 className="mb-3 text-sm font-semibold">
              {expert ? 'Your organization’s workflows' : 'Choose a workflow'}
            </h2>
            {workflows.length === 0 && !error ? (
              <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-zinc-500">
                {expert
                  ? 'Create your first workflow to start an Expert Learn session.'
                  : 'No READY workflows yet. Ask an expert in your organization to finish a Learn session.'}
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {workflows.map((w) => (
                  <WorkflowCard
                    key={w.id}
                    workflow={w}
                    expert={expert}
                    go={go}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function WorkflowCard({ workflow: w, expert, go }) {
  const sessions = useSessionsQuery(w.id, {
    pollingInterval: 5000,
    skipPollingIfUnfocused: true,
  })
  const active = sessions.data?.find((s) => !isTerminal(s.status))
  const start = () => go({ name: expert ? 'new' : 'join', workflowId: w.id })
  return (
    <article className="rounded-2xl border border-line bg-panel p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="truncate font-medium">{w.title}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${w.status === 'READY' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}
        >
          {statusLabel(w.status)}
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        By {w.createdBy?.name || 'your expert'} · {knowledgeOf(w).length}{' '}
        knowledge items
      </p>
      {w.definition?.apprentice?.context && (
        <p className="mt-3 line-clamp-2 text-sm text-zinc-600">
          {w.definition.apprentice.context}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className={secondaryClass}
          onClick={() => go({ name: 'map', workflowId: w.id })}
        >
          Work Map
        </button>
        {active ? (
          <button
            className={buttonClass}
            onClick={() =>
              go({ name: 'live', workflowId: w.id, sessionId: active.id })
            }
          >
            Resume session
          </button>
        ) : (
          <button className={buttonClass} onClick={start}>
            {expert ? 'Teach Ari in Meet' : 'Learn in Google Meet'}
          </button>
        )}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <div className="text-xs font-medium text-zinc-500">Your sessions</div>
        {sessions.isLoading ? (
          <p className="mt-2 text-xs text-zinc-500">Loading…</p>
        ) : sessions.error ? (
          <ErrorNotice error={sessions.error} retry={sessions.refetch} />
        ) : !sessions.data?.length ? (
          <p className="mt-2 text-xs text-zinc-500">No sessions yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sessions.data.slice(0, 5).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span>
                  {new Date(s.createdAt).toLocaleString()} ·{' '}
                  {statusLabel(s.status)}
                </span>
                <button
                  className="shrink-0 text-glow hover:underline"
                  onClick={() =>
                    go({
                      name: isTerminal(s.status) ? 'summary' : 'live',
                      workflowId: w.id,
                      sessionId: s.id,
                    })
                  }
                >
                  {isTerminal(s.status) ? 'View session' : 'Open'} →
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}
