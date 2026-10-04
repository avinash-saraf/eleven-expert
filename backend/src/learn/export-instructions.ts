// Turns a Work Map graph into instructions an agent can load: the same steps, in order,
// stopping where the expert would stop. Deterministic, so the export is reproducible.
type Graph = {
  status?: string;
  nodes: any[];
  edges: any[];
};

function steps(title: string, definition: any) {
  const apprentice = definition?.apprentice ?? {};
  const graph: Graph | undefined = apprentice.graph;
  if (!graph?.nodes?.length) return null;
  const items = new Map<string, any>(
    (apprentice.knowledge ?? []).map((item: any) => [item.id, item]),
  );
  const next = new Map<string, Array<{ to: string; when: string | null }>>();
  for (const edge of graph.edges ?? [])
    next.set(edge.source, [
      ...(next.get(edge.source) ?? []),
      { to: edge.target, when: edge.label ?? null },
    ]);
  const titles = new Map(graph.nodes.map((n: any) => [n.id, n.title]));
  const out = graph.nodes.map((node: any, index: number) => {
    const quote = node.knowledgeIds
      .map((id: string) => items.get(id)?.evidence?.[0]?.text)
      .find(Boolean);
    return {
      number: index + 1,
      id: node.id,
      type: node.type === 'decision' ? 'judgment_call' : 'step',
      title: node.title,
      action: node.decision,
      reason: node.reason || null,
      expertQuote: quote ?? null,
      guardrails: node.guardrails.map((g: any) => ({
        severity: g.severity === 'stop' ? 'stop_and_ask' : 'check',
        condition: g.condition,
        exception: g.exception ?? null,
      })),
      next: (next.get(node.id) ?? []).map((n) => ({
        to: n.to,
        toTitle: titles.get(n.to) ?? n.to,
        when: n.when,
      })),
    };
  });
  return { title, status: graph.status ?? 'draft', steps: out };
}

export function exportInstructionsJson(title: string, definition: unknown) {
  const built = steps(title, definition);
  if (!built) return null;
  return {
    ...built,
    stopConditions: built.steps.flatMap((step) =>
      step.guardrails
        .filter((g) => g.severity === 'stop_and_ask')
        .map((g) => ({ step: step.id, condition: g.condition })),
    ),
  };
}

export function exportInstructionsMarkdown(title: string, definition: unknown) {
  const built = exportInstructionsJson(title, definition);
  if (!built) return null;
  const lines: string[] = [
    `# Agent instructions: ${built.title}`,
    '',
    `Taught by an expert and captured by the AI Apprentice (${built.status === 'confirmed' ? 'confirmed by the expert' : 'draft, not yet confirmed'}).`,
    '',
    '## Operating rules',
    '- Do the steps in order. Follow the "Next" line when a step branches.',
    '- STOP AND ASK means: do not continue and do not guess. Hand the case to a human and say which condition applied.',
    '- A CHECK is a condition you must verify before continuing.',
    '- If the case is not covered below, stop and ask a human. Do not invent rules.',
    "- Judgment calls keep a human in the loop: state your decision and the expert's reason before acting.",
    '',
    '## Steps',
  ];
  for (const step of built.steps) {
    lines.push(
      '',
      `### ${step.number}. ${step.title}${step.type === 'judgment_call' ? ' (judgment call)' : ''}`,
      `Do: ${step.action}`,
    );
    if (step.reason) lines.push(`Why (expert): ${step.reason}`);
    if (step.expertQuote) lines.push(`Expert's words: "${step.expertQuote}"`);
    for (const g of step.guardrails)
      lines.push(
        `- ${g.severity === 'stop_and_ask' ? 'STOP AND ASK' : 'CHECK'}: ${g.condition}${g.exception ? ` (Exception: ${g.exception})` : ''}`,
      );
    for (const n of step.next)
      lines.push(
        `Next: ${n.when ? `if ${n.when}, ` : ''}go to step "${n.toTitle}"`,
      );
  }
  if (built.stopConditions.length) {
    lines.push('', '## All stop-and-ask conditions');
    for (const c of built.stopConditions) lines.push(`- ${c.condition}`);
  }
  return lines.join('\n') + '\n';
}
