// Panels that make the Apprentice Test visible: when Ari waits and asks, what it asks and
// why, whether the debrief closed its gaps, privacy, and whether the new hire learned.
const activityLabels = {
  connecting: ['Connecting…', 'bg-zinc-100 text-zinc-600'],
  speaking: ['Ari is speaking', 'bg-glow/10 text-glow'],
  talking: ['You are talking · Ari is listening', 'bg-zinc-100 text-zinc-700'],
  screen_active: [
    'Screen is changing · Ari is waiting',
    'bg-amber-50 text-amber-800',
  ],
  pause: ['Natural pause · Ari may ask', 'bg-emerald-50 text-emerald-700'],
}

export function ActivityChip({ activity }) {
  const [label, tone] = activityLabels[activity] || activityLabels.connecting
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
      {label}
    </span>
  )
}

const kindTone = {
  guardrail: 'bg-red-50 text-red-700',
  threshold: 'bg-amber-50 text-amber-800',
  exception: 'bg-amber-50 text-amber-800',
  reason: 'bg-blue-50 text-blue-700',
  followup: 'bg-zinc-100 text-zinc-700',
}

export function QuestionLog({ questions = [] }) {
  const live = questions.filter((q) => q.phase === 'task')
  const grounded = live.filter((q) => q.grounded).length
  const guardrails = live.filter((q) => q.kind === 'guardrail').length
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        Why Ari asked
      </h2>
      <p className="mt-2 text-sm">
        {live.length} live questions · {grounded} about something on screen ·{' '}
        {guardrails ? `${guardrails} about a guardrail ✓` : 'no guardrail yet'}
      </p>
      <ul className="mt-3 space-y-3">
        {live.map((q) => (
          <li key={q.at} className="text-sm">
            <span
              className={`mr-2 rounded-full px-2 py-0.5 text-xs capitalize ${kindTone[q.kind] || kindTone.followup}`}
            >
              {q.kind}
            </span>
            “{q.text}”
            {q.why && (
              <div className="mt-1 text-xs text-zinc-500">Because: {q.why}</div>
            )}
          </li>
        ))}
        {!live.length && (
          <li className="text-sm text-zinc-500">
            Questions appear here with the reason Ari chose them.
          </li>
        )}
      </ul>
    </section>
  )
}

export function DebriefChecklist({ debrief, phase }) {
  if (!debrief || (!debrief.planned.length && phase === 'task')) return null
  const planned = debrief.planned.length
  const rows = [
    [
      `Follow-up questions asked (${Math.min(debrief.asked, Math.max(planned, debrief.asked))}/${planned || '…'})`,
      debrief.asked >= 3,
    ],
    ['Teach-back confirmed by the expert', debrief.confirmed === true],
  ]
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        Debrief: has Ari understood?
      </h2>
      <ul className="mt-3 space-y-2 text-sm">
        {rows.map(([label, done]) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`grid h-5 w-5 place-items-center rounded-full text-xs ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}
            >
              {done ? '✓' : '·'}
            </span>
            {label}
          </li>
        ))}
      </ul>
      {planned > 0 && (
        <details className="mt-3 text-xs text-zinc-600">
          <summary className="cursor-pointer">Gaps Ari planned to ask</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {debrief.planned.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}

export function PrivacyPanel({ privacy, offRecord }) {
  if (!privacy) return null
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        Trust and privacy
      </h2>
      <ul className="mt-3 space-y-1.5 text-sm">
        <li>
          Off the record:{' '}
          <strong>{offRecord ? 'ON, nothing is saved' : 'off'}</strong>. Say
          “off the record” any time.
        </li>
        <li>
          Personal details removed from text: <strong>{privacy.text}</strong>
        </li>
        <li>
          Regions blurred on saved screens: <strong>{privacy.regions}</strong>
        </li>
        <li>
          Screens not saved (data could not be located):{' '}
          <strong>{privacy.skippedFrames}</strong>
        </li>
      </ul>
    </section>
  )
}

export function LatencyPanel({ latency }) {
  if (!latency || (!latency.samples && latency.lastAlertMs == null)) return null
  const sec = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`)
  return (
    <section className="rounded-2xl border border-line bg-panel p-3 text-xs text-zinc-600">
      Response after you stop talking: avg {sec(latency.avgResponseMs)} · last{' '}
      {sec(latency.lastResponseMs)} · warning after screen change:{' '}
      {sec(latency.lastAlertMs)}
    </section>
  )
}

export function masteryOf(graph, outcomes = {}) {
  const nodes = graph?.nodes || []
  const rows = nodes.map((n) => ({ node: n, outcome: outcomes[n.id] }))
  const done = rows.filter((r) =>
    ['correct', 'needed_help', 'mistake'].includes(r.outcome?.status),
  )
  const alone = done.filter((r) => r.outcome.status === 'correct').length
  return {
    rows,
    total: nodes.length,
    attempted: done.length,
    alone,
    helped: done.filter((r) => r.outcome.status === 'needed_help').length,
    mistakes: done.filter((r) => r.outcome.status === 'mistake').length,
    percent: done.length ? Math.round((alone / done.length) * 100) : 0,
  }
}

const outcomeTone = {
  correct: ['✓ On their own', 'text-emerald-700'],
  needed_help: ['◐ Needed help', 'text-amber-700'],
  mistake: ['✕ Mistake caught', 'text-red-700'],
  started: ['… In progress', 'text-zinc-500'],
}

export function Mastery({ graph, outcomes }) {
  const m = masteryOf(graph, outcomes)
  if (!m.total) return null
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Did the new hire learn?
        </h2>
        <span className="text-sm font-semibold">
          {m.alone}/{m.attempted || m.total} steps on their own · {m.percent}%
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {m.mistakes} mistake{m.mistakes === 1 ? '' : 's'} caught before saving ·{' '}
        {m.helped} step{m.helped === 1 ? '' : 's'} needed help
      </p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {m.rows.map(({ node, outcome }) => {
          const [label, tone] = outcomeTone[outcome?.status] || [
            'Not reached yet',
            'text-zinc-400',
          ]
          return (
            <li key={node.id} className="flex justify-between gap-3">
              <span>{node.title}</span>
              <span className={`shrink-0 text-xs ${tone}`}>{label}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
