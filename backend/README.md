# Eleven Expert Backend

NestJS 10 backend with Prisma 7 and a local PostgreSQL 17 database.
The backend runs on your host; Docker Compose runs PostgreSQL.

## Local setup

Use Node.js 22.12+ (or Node.js 24+) and Docker with the Compose plugin.
Run these commands from `backend/`:

```bash
nvm use
cp .env.example .env
npm install
npm run db:up
npm run prisma:deploy
npm run prisma:generate
npm run start:dev
```

Copy `.env.example` only if you do not already have a `.env` file.
`db:up` waits for PostgreSQL to pass its health check. NestJS listens on
`http://localhost:3000` and connects to the database during startup.
Stop the backend with Ctrl+C; its shutdown hooks close the Prisma connection.

## Database configuration

Compose and NestJS both read `backend/.env`. The default database is
`eleven_expert`, with the development-only user `eleven_expert` and password
`eleven_expert_dev`, exposed at `localhost:5401`.

```dotenv
DATABASE_URL="postgresql://eleven_expert:eleven_expert_dev@localhost:5401/eleven_expert?schema=public"
```

If you change `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, or
`POSTGRES_PORT`, update `DATABASE_URL` to match. URL-encode special characters
in credentials. PostgreSQL initialization settings apply only to a new data
volume; changing them does not update an existing database user or password.
If port 5401 is occupied, change `POSTGRES_PORT` and the URL port together.
A future backend container on the same Compose network should use hostname
`postgres` and port `5432` instead of `localhost` and the host port.
Keep `.env` out of Git and use separate credentials for deployments.

## Prisma workflow

The schema is in `prisma/schema.prisma`; connection and migration settings
are in `prisma.config.ts`. The initial migration creates `WorkMap`, `Session`,
`SessionEvent`, and `RecallWebhookDelivery`. Apply it with `npm run prisma:deploy`.
For later schema changes, create a new migration:

```bash
npm run prisma:migrate -- --name describe_your_change
npm run prisma:generate
```

Commit the schema and generated SQL in `prisma/migrations/`. Regenerate the
client after every schema change. Generated code in `src/generated/prisma/`
is ignored by Git. Build and development start scripts generate it automatically.
Apply committed migrations in deployments with `npm run prisma:deploy`.
Inspect the database with `npm run prisma:studio`.

Import `PrismaModule` into each feature module that needs database access,
then inject `PrismaService` into its providers. For example:

```typescript
constructor(private readonly prisma: PrismaService) {}

async checkDatabase() {
  return this.prisma.$queryRaw`SELECT 1`;
}
```

The integration follows the [NestJS Prisma recipe](https://docs.nestjs.com/recipes/prisma),
using the PostgreSQL adapter and a CommonJS generated client.

## Development commands

- `npm run build`: generate Prisma Client and compile the NestJS backend.
- `npm run start:prod`: run the compiled backend after building.
- `npm run lint`: lint and fix source and test files.
- `npm run format`: format source and test files with Prettier.
- `npm test -- --runInBand`: run unit tests without a database.
- `npm run test:e2e -- --runInBand`: test HTTP and a real Prisma PostgreSQL query;
  start PostgreSQL and apply migrations first. Session tests mock Recall, so they
  require no Recall credentials and never send bots to real meetings.
- `npm run test:cov`: collect unit test coverage.
- `npm run db:down`: stop PostgreSQL while retaining its named data volume.

To inspect PostgreSQL logs, run `docker compose logs -f postgres`.
`docker compose down --volumes` deletes the database data; use it only when
intentionally resetting your local database.

## Session API and Recall setup

The session and lifecycle integration is implemented. Realtime audio and PNG
ingestion is available through `/meetings/join` below. Expert workflow sessions
also support live speech transcription, Claude screen reasoning, spoken
clarification questions, and incremental Work Map knowledge saves.
Employee workflow sessions load the expert's saved Work Map and provide live
spoken guidance, answers, translated explanations, and corrections.
The legacy session API creates an empty Work Map for Learn sessions; the demo
workflow API uses an explicitly selected workflow for both modes.

Add these settings to your existing `.env`; do not replace it if it already
contains credentials. Generate a session key with `openssl rand -hex 32`.

```dotenv
SESSION_API_KEY=<generated-key>
RECALL_REGION=<your-region>
RECALL_API_KEY=<your-regional-api-key>
GOOGLE_LOGIN_GROUP_ID=<your-google-login-group-id>
RECALL_WORKSPACE_VERIFICATION_SECRET=<whsec_workspace-secret>
```

Supported regions are `us-east-1`, `us-west-2`, `eu-central-1`, and `ap-northeast-1`.
Use keys and the Login Group from the same Recall workspace and region.
The older `RECALL_GOOGLE_LOGIN_GROUP_ID` setting is also supported.
For a legacy workspace with a separate dashboard signing secret, also set
`RECALL_SVIX_WEBHOOK_SECRET`. Keep the Google SSO private key out of source
control; this backend does not need that key to create bots.

The backend can run with Recall settings blank while provisioning. Session
routes return 503 if the session API key is missing; session creation returns
503 if Recall is unconfigured. Unit tests use mocks and need no credentials.

Expose the backend through a public HTTPS tunnel or deployed backend, then
register `<public-backend-url>/webhooks/recall` in Recall's Webhooks dashboard.
Subscribe to bot lifecycle events. This endpoint is separate from the realtime
media WebSocket. Creating a session sends a real bot to its meeting
when valid Recall credentials are configured.

### Routes

All session routes require `Authorization: Bearer <SESSION_API_KEY>`.
The Recall webhook route uses Recall signatures instead of that bearer key.

| Method | Path                 | Behavior                                                     |
| ------ | -------------------- | ------------------------------------------------------------ |
| POST   | `/sessions`          | Create a Learn or Teach session and a Recall bot.            |
| GET    | `/sessions/:id`      | Get stored status, bot ID, error, and Work Map.              |
| POST   | `/sessions/:id/stop` | Request bot removal; webhooks confirm the call ended.        |
| POST   | `/webhooks/recall`   | Verify and durably enqueue a lifecycle delivery; return 202. |

Create a Learn session (replace the meeting URL and key):

```bash
curl -X POST http://localhost:3000/sessions \
  -H 'Authorization: Bearer <SESSION_API_KEY>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-learn-1' \
  -d '{"meetingUrl":"https://meet.google.com/abc-defg-hij","mode":"LEARN","title":"Refund workflow"}'
```

The response includes `id`, `recallBotId`, and `workMapId`. To start Teach mode,
send `mode: "TEACH"` and that `workMapId`; omit `title`. Learn mode may also use
an existing `workMapId` to continue a workflow. Only Google Meet URLs are accepted.

Use a stable, unique `Idempotency-Key` (1–128 visible ASCII characters) when
retrying creation. A repeated key with the same request returns the stored
session without creating another bot; a changed request returns 409. Omit the
key only when intentionally creating a new session every time.
Creation failures return 502 with `sessionId` and remain inspectable through GET.
A timeout may still create a bot: inspect Recall before using a new key. A signed
lifecycle event containing our session metadata can recover its bot association.

### Lifecycle delivery and recovery

The receiver verifies the raw request body with HMAC signatures and a five-minute
timestamp window. It supports modern `webhook-*` and legacy `svix-*` headers,
multiple signatures during rotation, and both lifecycle payload formats.
Invalid signatures never reach the database. Unsupported events are acknowledged
and ignored.

A PostgreSQL inbox worker runs every second, leases receipts, and applies session
events and status changes in a transaction. Duplicate delivery IDs are ignored;
late status events cannot rewind the session. Fatal errors remain failures even
when `done` arrives before or after them. Stop requests remain `STOPPING` until a
terminal webhook arrives. Permission events are stored without changing status.

Processing retries up to 20 attempts, with backoff capped at 30 seconds. Inspect
`RecallWebhookDelivery` in Prisma Studio for unprocessed receipts and `lastError`.
After fixing an association or database issue, set `attempts` to 0,
`lockedUntil` to null, and `nextAttemptAt` to the current time to retry a receipt.
Pending receipts survive backend restarts. Keep the backend clock synchronized
so signed requests pass the timestamp check.

Reference: [Create Bot](https://docs.recall.ai/reference/bot_create),
[bot lifecycle events](https://docs.recall.ai/docs/bot-status-change-events), and
[request verification](https://docs.recall.ai/docs/authenticating-requests-from-recallai).

## Meeting bot and realtime media

Expose port 3000 through a public HTTPS tunnel or deployment that forwards
WebSocket upgrades. Add the callback URL to your existing `.env`, then restart
NestJS. Use `wss://` and keep the trailing slash before any generated query:

```dotenv
RECALL_PUBLIC_WEBSOCKET_URL=wss://your-public-host/recall/media/
```

This flow requires `SESSION_API_KEY`, `RECALL_REGION`, `RECALL_API_KEY`, and
`GOOGLE_LOGIN_GROUP_ID`. It does not require a lifecycle webhook signing secret.
Recall receives a unique secret token in each callback URL; keep proxy query
strings out of access logs. Recall initiates a native WebSocket connection to
the existing NestJS HTTP server.

Create a bot for a real Google Meet:

```bash
curl -X POST http://localhost:3000/meetings/join \
  -H 'Authorization: Bearer <SESSION_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"meetingUrl":"https://meet.google.com/abc-defg-hij"}'
```

The response contains `botId`, `streamId`, and `mediaStatusUrl`. The bot uses
`google_meet.google_login_group_id`, `login_required: true`, `web_4_core`,
`audio_separate_raw`, `video_separate_png`, and `gallery_view_v2`. Its
`recording_config.realtime_endpoints` subscribes to `audio_separate_raw.data`
and `video_separate_png.data` at your authenticated callback URL.

Admit the bot if prompted, speak with your microphone unmuted, and share your
screen. Check the returned status URL with the same bearer key:

```bash
curl http://localhost:3000/meetings/<streamId>/media \
  -H 'Authorization: Bearer <SESSION_API_KEY>'
```

`connectionCount`, `audioPackets`, `videoFrames`, and `screenshareFrames` show
whether media reached NestJS. `connections` counts currently open sockets;
`lastPacketAt` contains the last received media timestamp. A successful create
response means Recall accepted the bot, not that it has joined yet. Creation
failures return 502 with a `streamId`; inspect Recall before retrying because
a timeout may still have created a bot. End this milestone's bots from the
Recall dashboard; `/sessions/:id/stop` applies to session-created bots.

The receiver decodes base64 into `Buffer`s and preserves participant IDs and
absolute/relative timestamps. Audio is mono 16 kHz signed 16-bit little-endian
PCM; PNG frames distinguish `webcam` and `screenshare`. Backend consumers can
inject `RecallMediaService` and subscribe to `packets(streamId)` for decoded
media. Keep subscribers fast: they execute on the receiver's event loop.

This milestone stores counters in memory and does not persist media or create
Work Maps. Use one backend process; restarting it invalidates existing stream
tokens. Disconnected streams expire after one hour, with a maximum of 100
tracked streams. Unit tests use simulated WebSocket frames and mocked Recall
requests; they never send real bots.

References: [separate audio](https://docs.recall.ai/docs/how-to-get-separate-audio-per-participant-realtime),
[separate video](https://docs.recall.ai/docs/how-to-get-separate-videos-per-participant-realtime),
and [WebSocket endpoints](https://docs.recall.ai/docs/real-time-websocket-endpoints).

## AI Apprentice: Expert Learn Mode

Add these credentials to your existing `.env`, then restart the backend:

```dotenv
ANTHROPIC_API_KEY=<anthropic-key>
ELEVENLABS_API_KEY=<elevenlabs-key>
ELEVENLABS_LEARN_AGENT_ID=<from npm run agents:create>
ELEVENLABS_TEACH_AGENT_ID=<from npm run agents:create>
# Optional overrides:
ANTHROPIC_MODEL=claude-sonnet-5-5
ELEVENLABS_AGENT_LLM=claude-sonnet-4-5
ELEVENLABS_VOICE_ID=
```

The voice is an **ElevenAgents** conversation (interviewer in Learn mode, tutor in
Teach mode), which handles turn-taking, interruptions and speech, using Scribe
realtime for listening and Expressive Mode for the voice. Run
`ELEVENLABS_API_KEY=... npm run agents:create` once and copy the two printed IDs
into `.env`. The prompts are sent per session from `src/learn/agent-prompts.ts`.
Claude runs silently beside the conversation: it turns screen frames into events
and Work Map knowledge, and pushes them to the agent as background context.
In Learn mode the expert can say "off the record" to pause transcripts and frames;
the agent can start a debrief with a teach-back when the task is done.
`ELEVENLABS_VOICE_ID` optionally overrides the agent's configured voice.
The existing `RECALL_PUBLIC_WEBSOCKET_URL` supplies the public hostname for both
input media and the bot's playback page. Your tunnel must forward HTTP and
WebSocket requests for `/recall/output/` as well as `/recall/media/`.
No additional database migration or package installation is needed for this stage.

Log in as an expert using `POST /auth/demo-login` with
`{"organizationName":"Sellmate","name":"Alex","role":"expert"}`. Use the
returned `accessToken` as the bearer token. Create a workflow with
`POST /workflows` and `{"title":"Refund process"}`, then start its Learn session:

```bash
curl -X POST https://api-meets.sellmate.kz/workflows/<workflowId>/sessions \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: refund-demo-1' \
  -d '{"meetingUrl":"https://meet.google.com/abc-defg-hij"}'
```

Admit the bot, share your screen, and explain your actions. Demonstrate an
unexplained decision, pause, and answer the apprentice's question inside Meet.
Reuse the idempotency key only when retrying the same session creation.
Expert sessions require the AI credentials before a bot is created.

Inspect `GET /workflows/<workflowId>/sessions/<sessionId>/apprentice` using the
same bearer token. It returns the live context, transcript/analysis/knowledge
counts, pending question, `replyCount`, `lastReply`, `lastLatency`, `voiceReady`, and provider/persistence error status.
Media packet counters remain available at the session's returned `mediaStatusUrl`.
Read `GET /workflows/<workflowId>` during the call to see knowledge arriving in
`definition.apprentice.knowledge`, with speaker, transcript evidence, timestamps,
and source session. Transcript and question events use the existing `SessionEvent`
table. The previous definition fields are preserved.

The receiver continuously streams the expert's 16 kHz audio to ElevenLabs Scribe.
It identifies the expert from the screenshare participant (initially the first
speaker). Claude receives recent committed speech, partial speech, running context,
and the latest two changed shared-screen frames. Screen-only analysis coalesces
incoming media at a 2.5-second minimum interval. New committed speech bypasses
that throttle; Scribe uses a 0.5-second silence threshold, followed by a 120 ms
backend debounce and a 100 ms scheduler. Partial speech waits for commitment.
Claude uses streaming JSON with reply text and its references before the longer
context/knowledge fields. A complete validated reply starts ElevenLabs voice
immediately while Claude finishes the update. Employee replies still validate
expert references and screen freshness before speaking. Model and network latency
remain; this does not guarantee an instant response.
Ask Ari directly, for example: “Ari, can you hear me?” or “What did you learn so far?”
Direct replies use committed speech and a short transcript pause; background audio
energy does not block them. New questions can be answered even when Ari has a
pending clarification. The 45-second cooldown applies only to Ari's own clarification
questions. Repeating a question in a new utterance allows another answer.
Incremental knowledge writes run alongside replies, rather than delaying voice.
Real participant speech interrupts Ari in either mode. Bot echo suppression is
limited to the active/recent utterance and clears partial transcription state.
ElevenLabs streams 24 kHz PCM to the playback page; Recall Output Media carries
the page's audio into the same meeting. No provider key reaches the page.

Stop with `POST /workflows/<workflowId>/sessions/<sessionId>/stop`. Signed Recall
terminal events also finalize learning; without lifecycle webhooks, a disconnected
media feed finalizes after a 30-second reconnection grace period. A workflow becomes
`READY` on finalization only if it contains confirmed learned entries. Knowledge is
saved throughout the call. Live context and speech connections use one backend
process; restart the session after a backend restart.

Provider references: [Recall Output Media](https://docs.recall.ai/docs/stream-media),
[ElevenLabs realtime transcription](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime),
[streaming speech](https://elevenlabs.io/docs/api-reference/text-to-speech/stream),
and [Claude Messages](https://platform.claude.com/docs/en/api/messages).
The low-latency reply path uses [Claude streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
and [structured-output property ordering](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#property-ordering).

### Troubleshooting live AI failures

Recall media connection/audio messages confirm ingestion; AI reasoning and voice
generation use separate provider requests. Warnings now include the failing stage:
`Claude reasoning`, `Work Map knowledge save`, or voice playback. Provider failures
include HTTP status, their error message, and Claude request ID when available;
database failures include the Prisma error code without printing connection strings.
The same safe message appears in the session's apprentice status and frontend.

Claude requests use [structured JSON outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
instead of forced tool calls, which the default Sonnet 5.5 model rejects. Repeated
reasoning failures back off to a 30-second retry interval. For missing model access,
set `ANTHROPIC_MODEL` to a supported vision model available to your API account;
for authentication or billing errors, check the corresponding provider account.
Changing backend environment variables requires a restart and a fresh session.
Share your screen inside Meet: the apprentice observes screenshare frames, not webcam video.
`Apprentice reply started` and `Apprentice reply spoken` identify generation/playback
progress. The frontend shows delivered replies and failed/interrupted voice attempts.
`Apprentice voice latency` logs scheduling, reply generation, first PCM sent, and
bot playback-start acknowledgment in milliseconds. The latest values are also
in `lastLatency`: `schedulingMs` and `responseMs` measure individual stages;
`firstAudioMs` and `playbackStartedMs` measure from committed transcript receipt.
They exclude Scribe's earlier transcription delay and Meet's later audio transport.
If transcripts arrive but `voiceReady` is false, check that your public tunnel serves
the bot's `/recall/output/` page and its WebSocket; inbound media alone does not
confirm that outbound voice is connected.

## AI Apprentice: Employee Teach Mode

Use the same AI credentials and public tunnel as Learn Mode. First finish an
expert Learn session with confirmed saved knowledge so its workflow becomes
`READY`. No new packages, database migration, or frontend-specific endpoint is needed.

1. Log in as an employee in the expert's organization:

   ```bash
   curl -X POST https://api-meets.sellmate.kz/auth/demo-login \
     -H 'Content-Type: application/json' \
     -d '{"organizationName":"Sellmate","name":"Sam","role":"employee"}'
   ```

2. With the returned employee `accessToken`, call `GET /workflows` to display
   available READY workflows. Select the expert's workflow ID.
3. Invite the apprentice to the employee's meeting:

   ```bash
   curl -X POST https://api-meets.sellmate.kz/workflows/<workflowId>/sessions \
     -H 'Authorization: Bearer <employeeAccessToken>' \
     -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: employee-refund-1' \
     -d '{"meetingUrl":"https://meet.google.com/abc-defg-hij"}'
   ```

The user role automatically selects `TEACH`. Admit the bot, share the employee's
screen, and speak to it: “Help me process this refund” or “Explain in Russian.”
Claude receives the **entire saved workflow definition** on each observation,
including all expert knowledge, plus the employee's recent speech and screen.
It tracks progress, suggests one action at a time, explains the expert's reasons,
answers questions, and calls out visible mistakes supported by the saved rules.
When knowledge is missing, it asks instead of inventing a rule.

Guidance and explanations follow the employee's spoken/requested language;
amounts and thresholds stay unchanged. Voice language support depends on the
chosen [ElevenLabs model](https://elevenlabs.io/docs/overview/models) and voice.
This translates workflow guidance; it does not continuously interpret everyone
else in the meeting. The employee is identified by screenshare, initially by the
first speaker, as in Learn Mode.

The AI waits for a speech pause, avoids repeated advice, and spaces general next
steps by 10 seconds; answers/corrections have a shorter 3-second cooldown.
A committed employee reply interrupts ongoing AI speech and triggers fresh
reasoning. Changed screens and speech are processed throughout the call, with
provider latency added to the roughly 2.5-second analysis interval.

`GET /workflows/<workflowId>/sessions/<sessionId>/apprentice` now includes
`mode`, `language`, `guidanceCount`, `lastGuidance`, voice readiness, and current
progress context. Stop via the existing `/stop` endpoint. Employee transcripts,
spoken advice (including expert knowledge references), delivery/interruption
events, and a closing progress summary use the existing `SessionEvent` table.
Teach Mode never edits the expert's Work Map or its READY status. A session uses
the workflow snapshot loaded when it starts; later expert edits apply to the
next employee session. `/meetings/join` remains a media-only endpoint.
