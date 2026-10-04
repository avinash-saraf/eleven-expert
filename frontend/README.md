# Eleven Expert

The React frontend uses RTK Query to connect to the NestJS backend. Google Meet
is the interface for live screen sharing and voice conversation.

## Run locally

Use Node 22.12+ (or Node 24+). Start the backend on port 3000, then:

```bash
cd frontend/web
npm install
npm run dev
```

Open http://localhost:5173. By default the browser calls `/api`, and Vite proxies
requests to `http://localhost:3000`. No frontend environment file is required for
local development. Copy `web/.env.example` to `web/.env` to override the target.
Do not place Recall, Anthropic, or ElevenLabs credentials in the frontend.

For a hosted frontend, set `VITE_API_BASE_URL=https://api-meets.sellmate.kz` before
building and add your frontend origin to the backend's `CORS_ORIGINS`. The local
Vite proxy is only available during development. Build with `npm run build`.
For persistent Ubuntu hosting with Nginx and Cloudflare Tunnel, follow
[the deployment guide](../deploy/README.md). Its frontend Docker image builds
with `https://api-meets.sellmate.kz` as the API URL by default.

## Expert flow

1. Sign in with your name, organization, and **expert** role.
2. Create a workflow, provide a Google Meet link, and start the Learn session.
3. Open Meet, admit Ari, and share your screen. Explain decisions and answer
   Ari's questions aloud. The web app displays real transcript, knowledge, media
   counters, bot status, and voice readiness.
4. Stop Ari from the session page, or end the call. Open the Work Map to review
   the actual saved knowledge and its transcript evidence.
5. Workflows become READY automatically after an expert session finishes with
   confirmed knowledge. READY replaces the prototype's manual publish button.

You can also start another expert session for an existing workflow. If creating
a bot fails or times out, check the workflow's sessions before starting another;
the form retains an idempotency key and never automatically retries creation.

## Employee flow

Sign in as **employee** using the expert's organization name. Select an available
READY workflow, enter your own Meet link, and start a Teach session. Admit Ari,
share your screen, and ask it for guidance or an explanation in your language.
Session history and summaries use saved backend events, without simulated
mastery scores. The Work Map remains the expert's source of truth.

Login persists in this browser until its token expires or you sign out. Reloading
a session URL resumes its status view; signing out clears cached API data.
Leaving the web page does not stop the Meet bot. Backend live AI context uses
one process, so a backend restart requires a new meeting session.

See [the API integration guide](docs/INTEGRATION.md) for endpoints and files.
