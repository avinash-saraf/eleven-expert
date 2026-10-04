import { sanitizeGraph } from './work-graph';

const knowledge = [
  { id: 'k1', kind: 'rule', moment: { id: 'm1' } },
  { id: 'k2', kind: 'step', moment: null },
  { id: 'k3', kind: 'warning' },
];

const node = (over: Record<string, unknown> = {}) => ({
  id: 'step_1',
  type: 'decision',
  title: 'Code the invoice',
  decision: 'Re-code to capex',
  reason: 'Equipment over 5000 is always capex',
  knowledgeIds: ['k1'],
  guardrails: [],
  ...over,
});

describe('sanitizeGraph', () => {
  it('keeps valid nodes and links the screen moment of cited knowledge', () => {
    const graph = sanitizeGraph(
      { nodes: [node()], edges: [] },
      knowledge,
      'draft',
    );
    expect(graph?.nodes[0].momentId).toBe('m1');
    expect(graph?.status).toBe('draft');
  });

  it('drops invented knowledge ids and nodes left with none', () => {
    const graph = sanitizeGraph(
      {
        nodes: [
          node({ knowledgeIds: ['k1', 'ghost'] }),
          node({ id: 'step_2', knowledgeIds: ['ghost'] }),
        ],
        edges: [],
      },
      knowledge,
      'draft',
    );
    expect(graph?.nodes).toHaveLength(1);
    expect(graph?.nodes[0].knowledgeIds).toEqual(['k1']);
  });

  it('only allows guardrails backed by a rule, exception, threshold or warning', () => {
    const guard = (knowledgeId: string) => ({
      severity: 'stop',
      condition: 'No asset number, no capex booking',
      exception: null,
      knowledgeId,
    });
    const graph = sanitizeGraph(
      {
        nodes: [node({ guardrails: [guard('k1'), guard('k2'), guard('x')] })],
        edges: [],
      },
      knowledge,
      'draft',
    );
    expect(graph?.nodes[0].guardrails.map((g) => g.knowledgeId)).toEqual([
      'k1',
    ]);
  });

  it('drops edges to unknown nodes and self loops, and rejects an empty graph', () => {
    const graph = sanitizeGraph(
      {
        nodes: [node(), node({ id: 'step_2', title: 'Submit' })],
        edges: [
          { source: 'step_1', target: 'step_2', label: 'amount over 5000' },
          { source: 'step_1', target: 'nope', label: null },
          { source: 'step_2', target: 'step_2', label: null },
        ],
      },
      knowledge,
      'confirmed',
    );
    expect(graph?.edges).toEqual([
      { source: 'step_1', target: 'step_2', label: 'amount over 5000' },
    ]);
    expect(
      sanitizeGraph({ nodes: [], edges: [] }, knowledge, 'draft'),
    ).toBeNull();
  });
});
