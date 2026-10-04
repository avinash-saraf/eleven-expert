import MomentImage from './MomentImage.jsx'
import { clock } from './ui.jsx'

// Everything behind one graph node: the expert's screen, words and guardrails.
export default function GraphDetail({ workflowId, node, knowledge }) {
  const byId = new Map(knowledge.map((item) => [item.id, item]))
  const cited = node.knowledgeIds.map((id) => byId.get(id)).filter(Boolean)
  const moment =
    cited.map((item) => item.moment).find((m) => m?.id === node.momentId) ||
    cited.find((item) => item.moment)?.moment
  const quotes = cited
    .flatMap((item) => item.evidence || [])
    .filter(
      (e, i, all) => e?.text && all.findIndex((x) => x?.id === e.id) === i,
    )
    .slice(0, 3)
  return (
    <>
      <span
        className={`mt-4 inline-block rounded-full px-2 py-0.5 text-xs ${node.type === 'decision' ? 'bg-amber-50 text-amber-800' : 'bg-zinc-100 text-zinc-700'}`}
      >
        {node.type === 'decision' ? 'Judgment call' : 'Step'}
      </span>
      <h3 className="mt-2 text-base font-semibold leading-snug">
        {node.title}
      </h3>
      {moment && (
        <figure className="mt-4">
          <MomentImage workflowId={workflowId} moment={moment} />
          <figcaption className="mt-2 text-xs text-zinc-500">
            Screen moment {clock(moment.offsetSeconds)} · {moment.caption}
          </figcaption>
        </figure>
      )}
      <h4 className="mt-5 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Decision
      </h4>
      <p className="mt-1 text-sm leading-relaxed">{node.decision}</p>
      <h4 className="mt-5 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Reason, in the expert’s words
      </h4>
      {node.reason ? (
        <p className="mt-1 text-sm leading-relaxed">{node.reason}</p>
      ) : (
        <p className="mt-1 text-sm text-zinc-500">
          The expert has not explained this yet.
        </p>
      )}
      <div className="mt-2 space-y-2">
        {quotes.map((e) => (
          <blockquote
            key={e.id}
            className="rounded-xl border border-glow/30 bg-glow/5 p-3 text-sm italic text-zinc-700"
          >
            “{e.text}”
          </blockquote>
        ))}
      </div>
      <h4 className="mt-5 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Guardrails
      </h4>
      {!node.guardrails.length && (
        <p className="mt-1 text-sm text-zinc-500">
          None recorded for this step.
        </p>
      )}
      <div className="mt-2 space-y-2">
        {node.guardrails.map((g, i) => (
          <div
            key={i}
            className={`rounded-xl border p-3 text-sm ${g.severity === 'stop' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
          >
            <strong>
              {g.severity === 'stop' ? 'Stop and ask: ' : 'Check: '}
            </strong>
            {g.condition}
            {g.exception && (
              <div className="mt-1 text-xs">Exception: {g.exception}</div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
