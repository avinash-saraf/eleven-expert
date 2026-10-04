// The Work Map as a graph: ordered steps and judgment calls, with the guardrails attached
// to the step they guard. Every node cites saved knowledge, so it stays tied to the
// expert's own words and screen moments. Stored in definition.apprentice.graph.
export type GraphGuardrail = {
  severity: 'stop' | 'warn';
  condition: string;
  exception: string | null;
  knowledgeId: string;
};

export type GraphNode = {
  id: string;
  type: 'step' | 'decision';
  title: string;
  decision: string;
  reason: string;
  knowledgeIds: string[];
  momentId: string | null;
  guardrails: GraphGuardrail[];
};

export type GraphEdge = {
  source: string;
  target: string;
  label: string | null;
};

export type WorkGraph = {
  version: 1;
  status: 'draft' | 'confirmed';
  updatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const GUARD_KINDS = new Set(['rule', 'exception', 'threshold', 'warning']);

export const GRAPH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['step', 'decision'] },
          title: { type: 'string' },
          decision: { type: 'string' },
          reason: { type: 'string' },
          knowledgeIds: { type: 'array', items: { type: 'string' } },
          guardrails: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                severity: { type: 'string', enum: ['stop', 'warn'] },
                condition: { type: 'string' },
                exception: { type: ['string', 'null'] },
                knowledgeId: { type: 'string' },
              },
              required: ['severity', 'condition', 'exception', 'knowledgeId'],
            },
          },
        },
        required: [
          'id',
          'type',
          'title',
          'decision',
          'reason',
          'knowledgeIds',
          'guardrails',
        ],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          label: { type: ['string', 'null'] },
        },
        required: ['source', 'target', 'label'],
      },
    },
  },
  required: ['nodes', 'edges'],
};

export const GRAPH_SYSTEM = `You turn what an AI Apprentice learned from an expert into a Work Map graph a new hire can follow.
Input: knowledge items (id, kind, statement, the expert's quote, when it was said), the previous graph if any, and the debrief outcome.
Rules:
- nodes are the process steps in the order the expert did them. type "decision" is a judgment call (a choice between options, a threshold, an exception handled); everything else is "step".
- Each node cites knowledgeIds: only ids from the input, at least one. Never invent facts, numbers or reasons. Merge items about the same action into one node; do not make a node per quote.
- decision: what the expert did, short and imperative. reason: why, in the expert's own words (shortened, from the quote). Empty reason only if the expert never explained.
- guardrails belong to the step they guard: limits, exceptions, "stop and ask someone" moments. Each must cite one knowledgeId whose kind is rule, exception, threshold or warning. severity "stop" means stop and ask or never do; "warn" means check or be careful. A guardrail may mention an exception only if the expert stated it.
- edges connect nodes in order. Make a straight chain unless the expert described a condition that leads to different next steps; then branch and label the edge with the condition (for example "amount over 5000"). Every node must be reachable.
- If a previous graph is given, keep the ids and wording of nodes that still hold, add new nodes with new ids, and change a node only when new knowledge or the debrief corrects it. If the expert's teach-back corrections contradict a node, fix it.
Return only JSON matching the schema.`;

// Cross-references a JSON schema cannot express. Drops bad references and returns null
// when what is left is not a usable graph, so a failed build never replaces a good one.
export function sanitizeGraph(
  raw: { nodes: any[]; edges: any[] },
  knowledge: Array<{
    id: string;
    kind: string;
    moment?: { id: string } | null;
  }>,
  status: WorkGraph['status'],
): WorkGraph | null {
  const items = new Map(knowledge.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const nodes: GraphNode[] = [];
  for (const node of raw.nodes ?? []) {
    if (!node || typeof node.id !== 'string' || seen.has(node.id)) continue;
    const knowledgeIds = [
      ...new Set<string>(
        (node.knowledgeIds ?? []).filter((id: unknown) =>
          items.has(id as string),
        ),
      ),
    ];
    if (!knowledgeIds.length || !node.title?.trim()) continue;
    seen.add(node.id);
    nodes.push({
      id: node.id,
      type: node.type === 'decision' ? 'decision' : 'step',
      title: String(node.title).trim().slice(0, 120),
      decision: String(node.decision ?? '')
        .trim()
        .slice(0, 300),
      reason: String(node.reason ?? '')
        .trim()
        .slice(0, 400),
      knowledgeIds,
      momentId:
        knowledgeIds
          .map((id) => items.get(id)?.moment?.id)
          .find((id): id is string => !!id) ?? null,
      guardrails: (node.guardrails ?? [])
        .filter(
          (g: any) =>
            g &&
            typeof g.condition === 'string' &&
            g.condition.trim() &&
            GUARD_KINDS.has(items.get(g.knowledgeId)?.kind ?? ''),
        )
        .slice(0, 6)
        .map((g: any) => ({
          severity: g.severity === 'stop' ? 'stop' : 'warn',
          condition: g.condition.trim().slice(0, 300),
          exception: g.exception?.trim()?.slice(0, 300) || null,
          knowledgeId: g.knowledgeId,
        })),
    });
  }
  if (!nodes.length) return null;
  const ids = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = (raw.edges ?? [])
    .filter(
      (e: any) =>
        e && ids.has(e.source) && ids.has(e.target) && e.source !== e.target,
    )
    .map((e: any) => ({
      source: e.source,
      target: e.target,
      label: e.label?.trim()?.slice(0, 80) || null,
    }));
  return {
    version: 1,
    status,
    updatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}
