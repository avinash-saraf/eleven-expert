import MomentImage from './MomentImage.jsx'
import { clock } from './ui.jsx'

// The expert's screen at the moment a rule was taught, beside the expert's own words.
export default function ExpertReplay({ workflowId, replay }) {
  if (!replay) return null
  return (
    <section
      key={replay.at}
      className="fade-up rounded-2xl border border-glow/40 bg-glow/5 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-glow">
          {replay.reason === 'alert'
            ? 'Look at how the expert handled this'
            : 'Expert’s screen'}
        </h2>
        <span className="text-xs text-zinc-500">
          Moment {clock(replay.offsetSeconds)}
        </span>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-[1.3fr_1fr]">
        <MomentImage
          workflowId={workflowId}
          moment={{ id: replay.momentId, caption: replay.caption }}
        />
        <div className="space-y-3 text-sm">
          <p className="text-xs text-zinc-500">{replay.caption}</p>
          {replay.quote && (
            <blockquote className="rounded-xl border border-line bg-panel p-3 italic text-zinc-700">
              “{replay.quote}”
            </blockquote>
          )}
          <p className="leading-relaxed">{replay.statement}</p>
        </div>
      </div>
    </section>
  )
}
