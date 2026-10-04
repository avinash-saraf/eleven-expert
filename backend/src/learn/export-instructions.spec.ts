import {
  exportInstructionsJson,
  exportInstructionsMarkdown,
} from './export-instructions';

const definition = {
  apprentice: {
    knowledge: [
      { id: 'k1', evidence: [{ text: 'Equipment over 5000 is always capex' }] },
    ],
    graph: {
      status: 'confirmed',
      nodes: [
        {
          id: 'step_1',
          type: 'decision',
          title: 'Code the invoice',
          decision: 'Re-code opex 4711 to capex 0400',
          reason: 'Equipment over 5000 is always capex',
          knowledgeIds: ['k1'],
          guardrails: [
            {
              severity: 'stop',
              condition: 'No asset number, no capex booking',
              exception: null,
            },
            {
              severity: 'warn',
              condition: 'Check the supplier is known',
              exception: 'Czech subsidiary',
            },
          ],
        },
        {
          id: 'step_2',
          type: 'step',
          title: 'Post',
          decision: 'Post the invoice',
          reason: '',
          knowledgeIds: ['k1'],
          guardrails: [],
        },
      ],
      edges: [
        { source: 'step_1', target: 'step_2', label: 'asset number present' },
      ],
    },
  },
};

describe('agent instructions export', () => {
  it('lists steps in order with guardrails, branches and stop conditions', () => {
    const md = exportInstructionsMarkdown('Invoices', definition)!;
    expect(md).toContain('### 1. Code the invoice (judgment call)');
    expect(md).toContain('STOP AND ASK: No asset number, no capex booking');
    expect(md).toContain(
      'CHECK: Check the supplier is known (Exception: Czech subsidiary)',
    );
    expect(md).toContain('Next: if asset number present, go to step "Post"');
    expect(md).toContain(
      'Expert\'s words: "Equipment over 5000 is always capex"',
    );
    expect(md).toContain('confirmed by the expert');
  });

  it('exports machine-readable stop conditions', () => {
    const json = exportInstructionsJson('Invoices', definition)!;
    expect(json.stopConditions).toEqual([
      { step: 'step_1', condition: 'No asset number, no capex booking' },
    ]);
  });

  it('returns null when there is no graph yet', () => {
    expect(exportInstructionsMarkdown('X', { apprentice: {} })).toBeNull();
  });
});
