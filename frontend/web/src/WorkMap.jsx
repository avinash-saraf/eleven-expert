import { useState } from 'react'
import {
  errorMessage,
  useRebuildGraphMutation,
  useWorkflowQuery,
} from './api.js'
import MomentImage from './MomentImage.jsx'
import WorkGraph, { graphCounts } from './WorkGraph.jsx'
import GraphDetail from './GraphDetail.jsx'
import ExportButtons from './ExportButtons.jsx'
import {
  ErrorNotice,
  Loading,
  buttonClass,
  clock,
  secondaryClass,
  knowledgeOf,
  statusLabel,
} from './ui.jsx'

const tones = {
  step: 'bg-zinc-100 text-zinc-700',
  decision: 'bg-glow/10 text-glow',
  rule: 'bg-blue-50 text-blue-700',
  threshold: 'bg-amber-50 text-amber-800',
  exception: 'bg-amber-50 text-amber-800',
  warning: 'bg-red-50 text-red-700',
}

export default function WorkMap({ workflowId, user, go }) {
  const query = useWorkflowQuery(workflowId, {
    pollingInterval: 5000,
    skipPollingIfUnfocused: true,
  })
  const [selection, setSelection] = useState(null)
  const [graphSelection, setGraphSelection] = useState(null)
  const [view, setView] = useState('graph')
  const [rebuild, rebuilding] = useRebuildGraphMutation()
  if (query.isLoading) return <Loading>Loading the Work Map…</Loading>
  if (query.error)
    return (
      <div className="p-6">
        <ErrorNotice error={query.error} retry={query.refetch} />
      </div>
    )
  const w = query.data
  const knowledge = knowledgeOf(w)
  const node = knowledge.find((item) => item.id === selection) || knowledge[0]
  const expert = user.role === 'expert'
  const graph = w.definition?.apprentice?.graph
  const hasGraph = graph?.nodes?.length > 0
  const showGraph = hasGraph && view === 'graph'
  const graphNode =
    graph?.nodes.find((n) => n.id === graphSelection) || graph?.nodes[0]
  const counts = hasGraph && graphCounts(graph)
  return (
    <div className="grid min-h-full lg:grid-cols-[1fr_360px]">
      <section className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <button
              className="text-xs text-zinc-500"
              onClick={() => go({ name: 'home' })}
            >
              ← Dashboard
            </button>
            <h1 className="mt-1 text-xl font-semibold">{w.title}</h1>
            <p className="mt-1 text-xs text-zinc-500">
              By {w.createdBy?.name || 'your expert'} · {knowledge.length} saved
              knowledge items · {statusLabel(w.status)}
            </p>
          </div>
          <button
            className={buttonClass}
            disabled={!expert && w.status !== 'READY'}
            onClick={() => go({ name: expert ? 'new' : 'join', workflowId })}
          >
            {expert ? 'Continue teaching in Meet' : 'Learn in Google Meet'} →
          </button>
        </div>
        {w.definition?.apprentice?.context && (
          <div className="m-5 rounded-2xl border border-glow/30 bg-glow/5 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wider text-glow">
              Expert context
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
              {w.definition.apprentice.context}
            </p>
          </div>
        )}
        {hasGraph && (
          <div className="space-y-3 px-5 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  {counts.steps} steps · {counts.decisions} judgment calls ·{' '}
                  {counts.guardrails} guardrails
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${graph.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                >
                  {graph.status === 'confirmed'
                    ? 'Confirmed by the expert'
                    : 'Draft · updates as the expert teaches'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {['graph', 'list'].map((name) => (
                  <button
                    key={name}
                    onClick={() => setView(name)}
                    className={`rounded-full border px-3 py-1 text-xs capitalize ${view === name ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-line hover:bg-zinc-100'}`}
                  >
                    {name}
                  </button>
                ))}
                <ExportButtons workflowId={workflowId} />
                {expert && (
                  <button
                    className={secondaryClass}
                    disabled={rebuilding.isLoading}
                    onClick={() => rebuild(workflowId)}
                  >
                    {rebuilding.isLoading ? 'Rebuilding…' : 'Rebuild graph'}
                  </button>
                )}
              </div>
            </div>
            {rebuilding.error && (
              <p className="text-xs text-red-700">
                {errorMessage(rebuilding.error)}
              </p>
            )}
            {showGraph && (
              <WorkGraph
                graph={graph}
                selectedId={graphNode?.id}
                onSelect={setGraphSelection}
              />
            )}
          </div>
        )}
        {!hasGraph && expert && knowledge.length >= 2 && (
          <div className="px-5 pt-5">
            <button
              className={secondaryClass}
              disabled={rebuilding.isLoading}
              onClick={() => rebuild(workflowId)}
            >
              {rebuilding.isLoading ? 'Building…' : 'Build the graph'}
            </button>
            {rebuilding.error && (
              <p className="mt-2 text-xs text-red-700">
                {errorMessage(rebuilding.error)}
              </p>
            )}
          </div>
        )}
        <div className={`flex-1 space-y-3 p-5 ${showGraph ? 'hidden' : ''}`}>
          {!knowledge.length ? (
            <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-zinc-500">
              {w.definition && Object.keys(w.definition).length
                ? 'This workflow contains a saved definition. Open the source below to inspect it.'
                : 'No confirmed knowledge yet. Start a Learn session, explain the workflow, and answer Ari’s questions.'}
            </div>
          ) : (
            knowledge.map((item, i) => (
              <button
                key={item.id || i}
                onClick={() => setSelection(item.id)}
                className={`flex w-full items-start gap-3 rounded-2xl border bg-panel p-4 text-left transition ${node === item ? 'border-glow shadow-sm' : 'border-line hover:bg-zinc-50'}`}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs">
                  {i + 1}
                </span>
                <span>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs capitalize ${tones[item.kind] || tones.step}`}
                  >
                    {item.kind}
                  </span>
                  {item.moment && (
                    <span className="ml-2 text-xs text-zinc-500">
                      ▶ Screen {clock(item.moment.offsetSeconds)}
                    </span>
                  )}
                  <span className="mt-2 block text-sm leading-relaxed">
                    {item.statement}
                  </span>
                </span>
              </button>
            ))
          )}
          <details className="rounded-xl border border-line bg-panel p-4">
            <summary className="cursor-pointer text-sm text-zinc-500">
              Saved workflow source
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(w.definition, null, 2)}
            </pre>
          </details>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-zinc-500">
          {w.status === 'READY'
            ? 'Ready workflows are available to employees in this organization.'
            : 'The workflow becomes READY when an expert session finishes with confirmed knowledge.'}
        </p>
      </section>
      <aside className="border-t border-line p-5 lg:border-l lg:border-t-0">
        <h2 className="text-sm font-semibold">
          {showGraph ? 'Step details' : 'Knowledge evidence'}
        </h2>
        {showGraph && graphNode ? (
          <GraphDetail
            workflowId={workflowId}
            node={graphNode}
            knowledge={knowledge}
          />
        ) : node ? (
          <>
            <div
              className={`mt-4 inline-block rounded-full px-2 py-0.5 text-xs capitalize ${tones[node.kind] || tones.step}`}
            >
              {node.kind}
            </div>
            <p className="mt-3 text-sm leading-relaxed">{node.statement}</p>
            {node.moment && (
              <figure className="mt-4">
                <MomentImage workflowId={workflowId} moment={node.moment} />
                <figcaption className="mt-2 text-xs text-zinc-500">
                  Screen moment {clock(node.moment.offsetSeconds)} ·{' '}
                  {node.moment.caption}
                </figcaption>
              </figure>
            )}
            <div className="mt-5 space-y-3">
              {(node.evidence || []).map((e, i) => (
                <figure
                  key={e?.id || i}
                  className="rounded-xl border border-glow/30 bg-glow/5 p-3"
                >
                  <blockquote className="text-sm italic text-zinc-700">
                    “{e?.text}”
                  </blockquote>
                  <figcaption className="mt-2 text-xs text-zinc-500">
                    {e?.participantName || 'Expert'} ·{' '}
                    {e?.occurredAt && new Date(e.occurredAt).toLocaleString()}
                  </figcaption>
                </figure>
              ))}
            </div>
            {node.learnedAt && (
              <p className="mt-4 text-xs text-zinc-500">
                Saved {new Date(node.learnedAt).toLocaleString()}
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">
            Evidence from the expert’s speech appears here as knowledge is
            saved.
          </p>
        )}
        <button className={`${secondaryClass} mt-6`} onClick={query.refetch}>
          Refresh Work Map
        </button>
      </aside>
    </div>
  )
}
