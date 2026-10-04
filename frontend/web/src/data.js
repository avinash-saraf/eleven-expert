// Demo content: Sabine's accounts-payable workflow. In production this is produced by the capture backend.
export const orgName = 'Schwabe Maschinenbau'
export const expert = { name: 'Sabine Keller', title: 'Head of Accounts Payable · 24 yrs' }
export const apprentice = { name: 'Ari' }

export const demoMap = {
  title: 'Month-end invoice triage',
  tool: 'AP workbench',
  duration: '21:08',
  nodes: [
    { id: 'n1', type: 'step', label: 'Open the invoice queue', x: 400, y: 40, t: '01:10', confidence: 0.9,
      action: 'Open the AP workbench and filter to invoices that can still post before close.',
      why: "Due date is not the priority at month-end. What can still post this period is. An invoice that slips a period costs more than one paid a few days late.",
      exceptions: ['Cash-discount invoices: sort these first, the discount window is real money.'],
      guardrails: ['Never let a postable invoice slip a period just because it is not due yet.'] },
    { id: 'n2', type: 'step', label: 'Match to PO & goods receipt', x: 400, y: 125, t: '03:25', confidence: 0.6,
      action: 'Check each invoice against the purchase order and the goods receipt.',
      why: 'A failed three-way match is the cheapest error and fraud catch we have. Never post on "close enough".',
      exceptions: ['Services without a goods receipt: match against the signed service confirmation.'],
      guardrails: ['Never post above €1,000 without a PO match.'],
      open: 'How much price difference do you accept before sending an invoice back?' },
    { id: 'n3', type: 'decision', label: 'Right cost center?', x: 400, y: 225, t: '07:42', confidence: 0.9,
      action: 'Compare the cost center on the invoice with the PO owner’s department.',
      why: 'Suppliers code the wrong department all the time. The PO owner decides the cost center, not the invoice header. Move it, leave a note, and do not wait for the supplier.',
      exceptions: ['Shared tooling: split 60/40 between Production and Maintenance, always.'],
      guardrails: ['Never move an invoice without leaving a note for the PO owner.'],
      drill: { q: 'An invoice for €4,200 of welding consumables is coded to Maintenance. The PO is owned by Production. Close is in two days.',
        choices: ['Post it as coded to hit close.', 'Move it to Production and leave a note for the PO owner.', 'Send it back to the supplier for a corrected invoice.'], answer: 1,
        reveal: 'Sabine: "The PO owner decides. Move it, leave a note, and do not wait for the supplier."' } },
    { id: 'n4', type: 'decision', label: 'Supplier on the watch list?', x: 400, y: 325, t: '11:05', confidence: 0.85,
      action: 'Check the supplier against the watch list before releasing anything.',
      why: 'One packaging supplier double-bills every December: the same invoice with a new number. In December I search by amount and date, never by invoice number.',
      exceptions: ['December: look for an identical amount in the last 30 days before releasing.'],
      guardrails: ['Never release a watch-list supplier’s invoice on the day it arrives in December.'],
      drill: { q: 'It is 12 December. Invoice 7731 from your usual packaging supplier is €2,380. An invoice 7702 for €2,380 was paid on 28 November.',
        choices: ['Pay it. The invoice numbers are different.', 'Hold it and ask the supplier to confirm it is not a duplicate.', 'Pay it and recover the money later.'], answer: 1,
        reveal: 'Sabine: "Different number, same amount, same month. That is their pattern. Hold it."' } },
    { id: 'n7', type: 'step', label: 'Block and query the supplier', x: 150, y: 435, t: '12:20', confidence: 0.95,
      action: 'Put the invoice on payment block, then email the supplier’s contact.',
      why: 'A block costs nothing. A duplicate payment costs weeks of recovery. Block first, ask second.',
      exceptions: [],
      guardrails: ['Block before you email.'] },
    { id: 'n5', type: 'decision', label: 'Intercompany invoice?', x: 565, y: 435, t: '15:30', confidence: 0.85,
      action: 'Check whether the invoice comes from a group company, such as the Czech subsidiary.',
      why: 'Intercompany invoices follow transfer-pricing rules, and auditors open them first. A second approval protects both of us, even when the match is clean.',
      exceptions: ['Intercompany under €500: one approval is enough.'],
      guardrails: ['Never self-approve an intercompany invoice.'],
      drill: { q: 'A €3,900 invoice from the Czech subsidiary. You matched the PO and goods receipt correctly.',
        choices: ['Post it. The match is clean.', 'Send it for a second approval.', 'Ask the subsidiary to resend it in EUR.'], answer: 1,
        reveal: 'Sabine: "A clean match is not the issue. It is intercompany. Always a second pair of eyes."' } },
    { id: 'n6', type: 'step', label: 'Request second approval', x: 670, y: 545, t: '17:50', confidence: 0.55,
      action: 'Send it to the finance controller with the PO, the match result, and your recommendation.',
      why: 'Say what you would do and why. Controllers approve in minutes when the thinking is already done.',
      exceptions: [],
      guardrails: ['Wait for written approval before posting.'],
      open: 'What do you do if the controller is on leave at month-end?' },
    { id: 'n8', type: 'step', label: 'Post and note the reason', x: 400, y: 650, t: '19:40', confidence: 0.9,
      action: 'Post the invoice with a one-line note on anything you changed.',
      why: 'The note is for the next person. If you moved it or held it, say why in one line. That is how the process document stays alive.',
      exceptions: [], guardrails: [] },
  ],
  edges: [['n1', 'n2'], ['n2', 'n3'], ['n3', 'n4'], ['n4', 'n7', 'Yes'], ['n4', 'n5', 'No'], ['n5', 'n6', 'Yes'], ['n5', 'n8', 'No'], ['n6', 'n8'], ['n7', 'n8']],
}

const sum = (k) => demoMap.nodes.reduce((a, n) => a + n[k].length, 0)
const gapsN = demoMap.nodes.filter((n) => n.open).length

// Scripted capture session (stands in for live audio + screen). who: expert|agent. probe: why|exception|guardrail|gap|summary
export const captureScript = [
  { who: 'expert', node: 'n1', text: 'Two days to close, sixty open. I filter to what can still post this month.' },
  { who: 'agent', probe: 'why', text: "You didn't start with the oldest invoice. Why?" },
  { who: 'expert', text: "Due date isn't the priority. What can still post this period is." },
  { who: 'expert', node: 'n2', text: 'Now I match each one against the purchase order and the goods receipt.' },
  { who: 'agent', probe: 'exception', text: 'Is there ever an invoice you post without a goods receipt?' },
  { who: 'expert', text: 'Services. Then I use the signed service confirmation.' },
  { who: 'agent', probe: 'gap', text: "I'm not sure how much price difference you accept. I'll flag that for your debrief." },
  { who: 'expert', node: 'n3', text: 'This one is coded to Maintenance, but Production owns the PO. I move it and leave a note.' },
  { who: 'agent', probe: 'why', text: 'You moved it without asking the supplier. Why?' },
  { who: 'expert', text: 'The PO owner decides the cost center, not the invoice header.' },
  { who: 'expert', node: 'n4', text: 'This supplier is on my watch list. Same invoice, new number, every December.' },
  { who: 'agent', probe: 'guardrail', text: 'How do you catch the duplicate?' },
  { who: 'expert', text: 'I search by amount and date, never invoice number. And I block it first.' },
  { who: 'expert', node: 'n5', text: "This one's from the Czech subsidiary, so it goes for a second approval." },
  { who: 'agent', probe: 'guardrail', text: 'Even with a clean match?' },
  { who: 'expert', text: 'Always. Intercompany is the first thing the auditors open.' },
  { who: 'agent', probe: 'gap', text: "I'm not sure what you do if the controller is on leave. Flagging that too." },
  { who: 'agent', probe: 'summary', text: `Captured ${demoMap.nodes.length} steps, ${sum('exceptions')} exceptions, ${sum('guardrails')} guardrails. ${gapsN} gaps need your input.` },
]

export const probeStyle = {
  why: ['Why', 'bg-glow/10 text-glow'],
  exception: ['Exception', 'bg-amber-100 text-amber-800'],
  guardrail: ['Guardrail', 'bg-red-100 text-red-700'],
  gap: ['Gap flagged', 'bg-zinc-200 text-zinc-700'],
  summary: ['Summary', 'bg-emerald-100 text-emerald-700'],
}

// Mock org analytics for the dashboard (backend replaces this).
export const team = [
  { name: 'Lena Fischer', role: 'AP Specialist · week 1', mastered: 3 },
  { name: 'Jonas Weber', role: 'AP Clerk · week 3', mastered: 6 },
  { name: 'Mira Hoffmann', role: 'Accountant · week 2', mastered: 5 },
  { name: 'Tobias Klein', role: 'AP Clerk · week 1', mastered: 1 },
]
export const stuckOn = [
  { q: 'What counts as "close enough" on a price variance?', node: 'n2', count: 7 },
  { q: 'Who approves when the controller is away?', node: 'n6', count: 5 },
  { q: 'Does the December rule apply to all packaging suppliers?', node: 'n4', count: 3 },
]

// Everything the expert owns that someone else would need to run. Drives "Knowledge at risk".
// weight: critical 3, high 2, medium 1. A process counts as captured when a session tagged with its id has a Work Map.
export const processInventory = [
  { id: 'invoice-triage', name: 'Month-end invoice triage', level: 'critical' },
  { id: 'supplier-master', name: 'Supplier master data changes', level: 'critical' },
  { id: 'intercompany-recon', name: 'Intercompany reconciliation', level: 'critical' },
  { id: 'payment-run', name: 'Payment run approvals', level: 'critical' },
  { id: 'year-end-accruals', name: 'Year-end accruals', level: 'high' },
  { id: 'supplier-disputes', name: 'Supplier dispute handling', level: 'high' },
  { id: 'vat-cross-border', name: 'VAT corrections on cross-border invoices', level: 'high' },
  { id: 'audit-evidence', name: 'Audit evidence preparation', level: 'high' },
  { id: 'fx-revaluation', name: 'Foreign-currency invoice revaluation', level: 'high' },
  { id: 'credit-notes', name: 'Credit notes and returns', level: 'medium' },
  { id: 'vendor-onboarding', name: 'Vendor onboarding checks', level: 'medium' },
  { id: 'blocked-backlog', name: 'Blocked-invoice backlog review', level: 'medium' },
]
export const levelWeight = { critical: 3, high: 2, medium: 1 }

// Scripted learner practice session (stands in for the learner's live screen share + voice).
// who: ari|learner. kind (ari): guide|correct|praise|answer. ask: learner question to Ari.
export const learnScript = [
  { who: 'ari', kind: 'guide', node: 'n1', text: "Let's clear a few invoices together. Share your screen and open the queue." },
  { who: 'learner', node: 'n1', text: 'Sorting by due date, oldest first.' },
  { who: 'ari', kind: 'correct', node: 'n1', text: "Pause. Sabine doesn't start with due date. Start with what can still post before close." },
  { who: 'learner', node: 'n1', text: 'Okay, filtering to invoices that can still post this month.' },
  { who: 'ari', kind: 'praise', text: 'Good. Now match each one against the purchase order.' },
  { who: 'learner', node: 'n2', text: 'Matching the packaging invoice to its PO. It is €40 higher.' },
  { who: 'ari', kind: 'guide', node: 'n2', text: 'Is there a goods receipt for it?' },
  { who: 'learner', node: 'n2', text: 'Yes, the goods receipt is there.' },
  { who: 'learner', node: 'n3', ask: true, text: 'Why does the PO owner decide the cost center?' },
  { who: 'ari', kind: 'answer', node: 'n3', text: 'Sabine says suppliers code the wrong department all the time. The PO owner knows who actually received the goods.', cite: 'Sabine · 07:42' },
  { who: 'learner', node: 'n3', text: "Then I'll move it to Production and leave a note." },
  { who: 'ari', kind: 'praise', text: "Exactly Sabine's call." },
  { who: 'learner', node: 'n4', text: 'Invoice 7731 for €2,380. The number is new, so I will pay it.' },
  { who: 'ari', kind: 'correct', node: 'n4', text: "Stop. It's December and that supplier double-bills. Check for the same amount first, and block before you ask." },
  { who: 'learner', node: 'n7', text: 'Blocking the invoice and emailing the supplier.' },
  { who: 'ari', kind: 'praise', text: 'Block first, ask second. That is the rule.' },
  { who: 'ari', kind: 'summary', text: "That's a wrap. You practiced 5 of 8 steps with 2 corrections. Let's review." },
]

export const kindStyle = {
  guide: ['Guide', 'bg-zinc-100 text-zinc-600'],
  correct: ['Correction', 'bg-red-100 text-red-700'],
  praise: ['Nice', 'bg-emerald-100 text-emerald-700'],
  answer: ['From Sabine', 'bg-glow/10 text-glow'],
  summary: ['Summary', 'bg-zinc-100 text-zinc-600'],
}

export function summarize(script = learnScript) {
  const practiced = [...new Set(script.filter((e) => e.who === 'learner' && e.node).map((e) => e.node))]
  const corrections = script.filter((e) => e.kind === 'correct').map((e) => ({ node: e.node, text: e.text }))
  const questions = script.filter((e) => e.ask).map((e) => ({ q: e.text, node: e.node }))
  const mastered = practiced.filter((n) => !corrections.some((c) => c.node === n))
  return { practiced, corrections, questions, mastered }
}
