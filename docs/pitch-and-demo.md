# Pitch notes and Apprentice Test answers

Draft for the team. Claims below describe what the demo is built to show; confirm each one
works in a dry run before saying it on stage.

## The Apprentice Test: one answer each, and where to show it

1. **When to ask.** Ari is an ElevenAgents voice agent listening through Scribe realtime.
   It only answers after the expert's turn ends, and uses `skip_turn` while they type or
   think. *Show:* the live page chip that switches between "You are talking", "Screen is
   changing, Ari is waiting" and "Natural pause, Ari may ask".
2. **What to ask.** Claude watches frames and speech beside the conversation and hands Ari
   unexplained decisions, guardrails first. It never repeats what the screen or the expert
   already said. *Show:* "Why Ari asked" panel: each question with its kind and the on-screen
   reason, plus the count of questions and the guardrail tick.
3. **When it understood.** After the task Ari runs a debrief of 3+ follow-ups the expert has
   not answered, teaches the process back, and only calls it done when the expert confirms.
   *Show:* the debrief checklist (questions asked, teach-back confirmed) and the Work Map
   status changing from Draft to "Confirmed by the expert".
4. **Whether the new hire learned.** The tutor tracks every step (on their own, needed help,
   mistake caught before saving) on a case the expert never showed. *Show:* the step
   scorecard and the graph with "You are here".
5. **Trust.** Say "off the record" and nothing is saved, including the sentence that asked.
   Emails, phone numbers, IBANs and cards are removed from text, and personal data on stored
   screens is blurred; if it cannot be located the screen is not kept. *Show:* the privacy
   panel counters, and the blurred "Remit to" box in a stored screen moment.

## Moonshot slide

**Title: Every expert becomes a living company memory, then a safe agent.**

- **Today (MVP):** one expert, one task, one new hire. Ari learns the work, asks why, maps
  steps and guardrails, and teaches the next person.
- **Next:** every expert and workflow in one Work Map that stays current. When the work
  changes, Ari asks only about what is new.
- **Then people first, then agents:** the same steps and stop conditions that teach a new
  hire are exported as agent instructions (already in the product: *Export for agents*), so
  agents take routine steps and stop where the expert would, while people keep the judgment
  calls.
- **Path:** MVP graph and guardrails, then multi-expert diffs, then agent execution against
  the exported guardrails, then always-on apprentice that notices unseen cases at work.

## Demo script (about 6 minutes)

Use any fake-data workflow; the invoice example is shown. See `docs/CHANGES-AND-DEMO.md` for the full plan.

1. **Expert (Learn).** Work three invoices while talking:
   re-code the over-5,000 equipment invoice to capex, hold the December freight invoice,
   send the Czech subsidiary invoice for second approval. Expect 3+ questions, one on a
   guardrail. Say "off the record" once, then back on.
2. **Debrief.** Agree to wrap up. Answer the follow-ups, correct one detail in the teach-back,
   confirm.
3. **Work Map.** Open the graph: steps, judgment calls, guardrails. Click the capex step: the
   screen moment, the expert's words, the guardrails. Show *Export for agents*.
4. **New hire (Teach).** Open a fresh 7,200 euro equipment invoice the expert never showed
   and reach for the opex code before saving. The tutor interrupts, replays the
   expert's screen in the call, and explains with the expert's reason. Fix it, finish the case.
5. **Result.** Scorecard: steps on their own, mistakes caught before saving.
