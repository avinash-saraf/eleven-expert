# What changed since `main`, and how to run the demo

For the teammate running the demo. Nothing here has been tested end to end with a live call
yet, so do the dry run in section 4 before the real thing.

## 1. What changed since `main`

On `main`, a hand-built loop called Claude every second or so and played its reply through
plain text-to-speech. That felt like a silent observer: slow, robotic, two questions in a
row, and no debrief. It now works like this.

| Area | Before (`main`) | Now |
|---|---|---|
| Voice | Plain text-to-speech, default voice | **ElevenAgents** conversation (interviewer in Learn, tutor in Teach) with Expressive Mode voice and Scribe realtime listening. It handles turn-taking and interruptions. |
| Conversation style | One short sentence, minimal | Warm and conversational. Reacts to answers, says "I have two questions" before asking two, stays quiet while you type. |
| Claude's role | Decided what to say and spoke | Works silently beside the call: turns screen frames into events, extracts knowledge, and hands Ari questions worth asking. |
| Debrief | Did not exist | Ari offers a debrief, asks 3+ follow-ups, teaches the process back, and the expert confirms. The result is saved. |
| Work Map | Flat list of facts | **Graph**: ordered steps, judgment calls, guardrails attached to each step, branches. Builds live as a draft and is finalised after the debrief. Clickable view plus the old list. |
| Screen moments | None | A frame is saved when the screen meaningfully changes. Every step shows its screen, the expert's words and its guardrails. |
| Teach mode | Spoken guidance only | The tutor teaches the graph in order, warns before a guardrail is broken, and **replays the expert's screen** in the call (on Ari's video tile) and on the learner's page. |
| New-hire progress | None | Per-step result (on their own, needed help, mistake caught) with a scorecard and "You are here" on the graph. |
| Trust | None | "Off the record" command, personal data removed from text, personal data blurred on saved screens. |
| Agent export | None | "Export for agents" button: the Work Map as instructions an agent can load, including stop-and-ask conditions. |
| Evidence panels | None | Live chips and panels that show when Ari waits, why it asked, debrief progress, privacy counters and response timings. |

Main code locations: `backend/src/learn/` (agent, prompts, graph, redaction, metrics),
`backend/src/moments/` (screen frames), `frontend/web/src/` (Work Map graph, evidence panels).

## 2. Setup and environment variables

### New or changed variables in `backend/.env` (send values separately, never commit them)

| Variable | What it is |
|---|---|
| `ELEVENLABS_API_KEY` | Same name as before, but the key now needs the **ElevenAgents (write)** permission. |
| `ELEVENLABS_LEARN_AGENT_ID` | **New.** The interviewer agent, created with `npm run agents:create`. |
| `ELEVENLABS_TEACH_AGENT_ID` | **New.** The tutor agent, same script. |
| `ELEVENLABS_AGENT_LLM` | **New, optional.** The model behind the agents. Leave out for the default. |
| `ELEVENLABS_VOICE_ID` | Now optional. Overrides the agent's voice on every session. |
| `ELEVENLABS_TTS_MODEL` | **Removed.** Delete it if present; it is no longer read. |
| `RECALL_PUBLIC_WEBSOCKET_URL` | Same variable, but it must be a **public tunnel** to your own backend, `wss://`, ending in exactly `/recall/media/` (with the trailing slash). Using the team's deployed address gives a 401. |

Everything else (`DATABASE_URL`, `RECALL_*`, `ANTHROPIC_*`, `GOOGLE_LOGIN_GROUP_ID`,
`SESSION_API_KEY`, `CORS_ORIGINS`, Postgres settings) is unchanged.

### One-time steps on a new machine

1. `backend/.env` filled in as above. `frontend/web/.env` can be copied from `.env.example`.
2. In `backend/`: `npm install`, `npm run db:up`, `npm run prisma:deploy`.
3. In `frontend/web/`: `npm install`.
4. Start a public tunnel to port 3000 (for example `cloudflared tunnel --url http://localhost:3000`)
   and put its address in `RECALL_PUBLIC_WEBSOCKET_URL`.
5. Agents: the two agents already exist, so only the IDs are needed. Do **not** re-run
   `npm run agents:create` unless you want new agents.

### Every time

`backend/`: `npm run start:dev`, `frontend/web/`: `npm run dev`, open http://localhost:5173.
Restart the backend after any `.env` change, and start a **new session** after each restart
(an old bot's connection stops working).

## 3. What to include in the demo

Pick one fake-data workflow with a visible number or choice, a threshold, and a "stop and ask"
case. Two examples that fit the brief:

- **Invoices:** recode an equipment invoice over 5,000 to capex, hold a December double-biller,
  send a Czech-subsidiary invoice for second approval. New hire reaches for opex on a 7,200
  equipment invoice.
- **Refunds:** the expert refunds 70 on a fulfilled 100 order because shipping is not
  refundable. The new hire tries 100.

Use screens with large text and no real customer data.

### Flow (about 6 minutes)

1. **Learn.** Share the screen in Meet and work 2 or 3 cases while talking. Show: Ari
   reacting naturally, asking at pauses, one question about a limit or when to stop and ask.
   Say "off the record" once to show it, then resume.
2. **Debrief.** Agree to wrap up. Answer the follow-ups, correct one detail in the teach-back,
   then confirm.
3. **Work Map.** Open the graph and click a step: screen moment, the decision, the reason in
   the expert's words, guardrails. Show "Export for agents".
4. **Teach.** Join as the new hire on a case the expert never showed. Make the wrong choice
   **before saving**. The tutor should interrupt, show the expert's screen in the call (pin
   Ari's tile in Meet), and explain with the expert's reason. Fix it and finish.
5. **Result.** Show the scorecard (steps on their own, mistakes caught).
6. **Pitch end.** One moonshot slide: see `docs/pitch-and-demo.md`.

### Panels to point at (each answers one question the judges must hear)

- The **activity chip** (when it asks), **Why Ari asked** (what it asks), the **debrief
  checklist** (when it understood), the **scorecard** (did the new hire learn), and the
  **privacy panel** (trust).

## 4. Dry run before the real thing

Do the whole flow at least twice and check:

- Ari greets you and speaks at a natural pause, and asks at least 3 questions, one a guardrail.
- Asking two things in a row comes with a heads-up, and the debrief teach-back is confirmed.
- The graph appears with sensible steps, and the screen frame shows on a clicked step.
- The tutor's warning arrives **before** you press save. The timing panel on the live page
  shows how long it takes.
- The expert's screen appears on Ari's tile in Meet and on the learner's page.

If something is off, note what you said and what Ari did, so it can be tuned.

## 5. Common problems

| Symptom | Likely cause |
|---|---|
| "Invalid media stream credentials" (401) | Wrong `RECALL_PUBLIC_WEBSOCKET_URL`, or the backend restarted after the session began. Fix the tunnel URL, restart, start a new session. |
| "must be a public wss:// URL ending in /recall/media/" | Missing trailing slash, or `https://` instead of `wss://`. |
| Bot joins but is silent | Look for "ElevenAgents connected" in the backend log. Check the agent IDs and the key's ElevenAgents permission. |
| No graph on an old Work Map | Old maps predate the graph. Use "Build the graph", or run a new Learn session. |
| No screen frame on steps | Those maps predate screen moments. Record a new session. |
| Replay does not show on Ari's tile | Pin Ari in Meet. If still nothing, the learner's page shows the same replay. |

## 6. Known limits

- Personal-data removal catches emails, phone numbers, IBANs and card numbers in text, and
  blurs located personal data on stored screens. It does not catch names spoken aloud.
- Replay is a still frame, not a video clip.
- The tutor's warning speed depends on the screen check plus a model call and has not been
  measured on a real call yet.
