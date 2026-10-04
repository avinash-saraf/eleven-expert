import { useMemo } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'

const W = 230
const H = 104

function GraphNode({ data, selected }) {
  const { node, index, current, outcome } = data
  const decision = node.type === 'decision'
  const stops = node.guardrails.filter((g) => g.severity === 'stop').length
  const warns = node.guardrails.length - stops
  return (
    <div
      className={`w-[230px] rounded-2xl border-2 bg-panel px-3 py-2 text-left shadow-sm transition ${
        decision ? 'border-amber-400' : 'border-zinc-300'
      } ${selected ? 'ring-4 ring-glow/30' : ''} ${current ? 'ring-4 ring-emerald-400/60' : ''} ${outcome === 'correct' ? 'bg-emerald-50' : outcome === 'mistake' ? 'bg-red-50' : outcome === 'needed_help' ? 'bg-amber-50' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
        <span>
          {decision ? 'Judgment call' : 'Step'} {index + 1}
        </span>
        {current && <span className="text-emerald-600">You are here</span>}
      </div>
      <div className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">
        {node.title}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {stops > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] text-red-700">
            ⛔ {stops} stop & ask
          </span>
        )}
        {warns > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
            ⚠ {warns} check
          </span>
        )}
        {outcome && outcome !== 'started' && (
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-zinc-700">
            {outcome === 'correct'
              ? '✓ done'
              : outcome === 'mistake'
                ? '✕ caught'
                : '◐ helped'}
          </span>
        )}
        {node.momentId && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600">
            ▶ screen
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { work: GraphNode }

function layout(graph, currentId, outcomes) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 })
  graph.nodes.forEach((n) => g.setNode(n.id, { width: W, height: H }))
  graph.edges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)
  const nodes = graph.nodes.map((node, index) => {
    const p = g.node(node.id)
    return {
      id: node.id,
      type: 'work',
      position: { x: p.x - W / 2, y: p.y - H / 2 },
      data: {
        node,
        index,
        current: node.id === currentId,
        outcome: outcomes?.[node.id]?.status,
      },
    }
  })
  const edges = graph.edges.map((e, i) => ({
    id: `${e.source}-${e.target}-${i}`,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
    labelStyle: { fontSize: 11 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 8,
  }))
  return { nodes, edges }
}

export default function WorkGraph({
  graph,
  selectedId,
  onSelect,
  currentId,
  outcomes,
  height = 'h-[560px]',
}) {
  // Positions depend on structure only, so selecting a node never re-lays-out the graph.
  const { nodes, edges } = useMemo(
    () => layout(graph, currentId, outcomes),
    [graph.updatedAt, currentId, JSON.stringify(outcomes || {})],
  )
  return (
    <div className={`${height} rounded-2xl border border-line bg-panel`}>
      <ReactFlow
        nodes={nodes.map((n) => ({ ...n, selected: n.id === selectedId }))}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect?.(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export const graphCounts = (graph) => ({
  steps: graph.nodes.filter((n) => n.type === 'step').length,
  decisions: graph.nodes.filter((n) => n.type === 'decision').length,
  guardrails: graph.nodes.reduce((sum, n) => sum + n.guardrails.length, 0),
})
