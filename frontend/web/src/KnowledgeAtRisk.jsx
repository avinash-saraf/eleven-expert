import { useState } from 'react'
import { coverageOf, useHorizon } from './knowledge.js'

const levelChip = {
  critical: 'bg-red-500/20 text-red-200',
  high: 'bg-amber-400/20 text-amber-200',
  medium: 'bg-white/10 text-zinc-300',
}

// Expert hero: how much of their judgment is captured vs. how much time is left.
export default function KnowledgeAtRisk({ workflows, user, go }) {
  const [{ retireMonths: months, tenureYears }, setHorizon] = useHorizon(user.id)
  const [editing, setEditing] = useState(false)
  const c = coverageOf(workflows)
  const weeks = Math.max(1, Math.round(months * 4.345))
  const every = Math.max(1, Math.round(weeks / Math.max(1, c.remaining)))
  const status =
    c.coverage >= 70
      ? ['On track', 'bg-emerald-400/20 text-emerald-200']
      : c.coverage >= 35
        ? ['Needs attention', 'bg-amber-400/20 text-amber-200']
        : ['At risk', 'bg-red-500/25 text-red-200']
  const saveMonths = (v) =>
    setHorizon({ retireMonths: Math.max(1, Math.min(120, Number(v) || 1)) })

  return (
    <section className="overflow-hidden rounded-3xl bg-zinc-900 p-6 text-white md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">
          Knowledge at risk
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${status[1]}`}>
          {status[0]}
        </span>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr_1.2fr]">
        <div>
          <div className="flex items-baseline gap-2">
            {editing ? (
              <input
                autoFocus
                type="number"
                min="1"
                max="120"
                aria-label="Months until retirement"
                defaultValue={months}
                onBlur={(e) => {
                  saveMonths(e.target.value)
                  setEditing(false)
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                className="w-24 rounded-lg border border-white/20 bg-white/10 px-2 text-5xl font-semibold tracking-tight outline-none"
              />
            ) : (
              <span className="text-6xl font-semibold tracking-tight">{months}</span>
            )}
            <span className="text-lg text-zinc-300">months</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            until you retire, with {tenureYears} years of judgment still in your head.
          </p>
          <button
            onClick={() => setEditing((v) => !v)}
            className="mt-3 text-xs text-zinc-400 underline-offset-2 hover:text-white hover:underline"
          >
            Edit your horizon
          </button>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-zinc-300">Captured</span>
            <span className="text-3xl font-semibold">{c.coverage}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white transition-all"
              style={{ width: `${c.coverage}%` }}
            />
          </div>
          <div className="mt-4 space-y-1.5 text-sm text-zinc-300">
            <div className="flex justify-between">
              <span>Critical processes</span>
              <span className="text-white">
                {c.critical.done} of {c.critical.total}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Processes captured</span>
              <span className="text-white">
                {c.captured} of {c.inventory.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Pace to finish in time</span>
              <span className="text-white">
                1 every {every} wk{every > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm text-zinc-300">Capture next</div>
          <ul className="space-y-2">
            {c.next.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => go({ name: 'new', workflowId: `process:${p.id}` })}
                  className="group flex w-full items-center justify-between gap-3 rounded-xl bg-white/5 px-3.5 py-2.5 text-left transition hover:bg-white/10"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{p.name}</span>
                    <span
                      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs capitalize ${levelChip[p.level]}`}
                    >
                      {p.level}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-zinc-300 group-hover:text-white">
                    Start capture →
                  </span>
                </button>
              </li>
            ))}
            {c.next.length === 0 && (
              <li className="rounded-xl bg-white/5 px-3.5 py-3 text-sm text-zinc-300">
                Everything on your list is captured or in progress.
              </li>
            )}
          </ul>
        </div>
      </div>
      <p className="mt-6 text-xs text-zinc-400">
        Coverage is weighted by how critical each process is. The process list is a
        demo inventory until it is connected to your organization.
      </p>
    </section>
  )
}
