# Frontend API integration

`web/src/api.js` defines the [RTK Query](https://redux.js.org/toolkit/rtk-query/overview)
API, generated hooks, bearer headers, cache tags, and readable errors.
`store.js` installs the API reducer/middleware and resets cached data on logout;
`auth.js` persists only demo identity, token, and expiry. The old prototype's
`apprentice-v1` localStorage data and mock scripts are not used by the app.

## Backend contract

| Action | Endpoint | Body / result |
| --- | --- | --- |
| Demo login | `POST /auth/demo-login` | `{organizationName, name, role: "expert" or "employee"}` -> `{accessToken, expiresAt, user}` |
| Verify identity | `GET /auth/me` | `{id, name, role, organization: {id, name}}` |
| List / select workflows | `GET /workflows`, `GET /workflows/:workflowId` | Actual Work Maps; employees see READY workflows with knowledge |
| Create workflow | `POST /workflows` | `{title}`; expert only |
| Invite bot | `POST /workflows/:workflowId/sessions` | `{meetingUrl}`, `Idempotency-Key` header; role selects LEARN/TEACH |
| Session history / status | `GET /workflows/:workflowId/sessions`, `GET .../sessions/:sessionId` | Own sessions; `id`, `workflowId`, `meetingUrl`, `mode`, `status`, `botId` |
| Stop / save | `POST .../sessions/:sessionId/stop` | Leaves Meet and finalizes the apprentice |
| Media health | `GET .../sessions/:sessionId/media` | Audio/screen counters and connections |
| Live apprentice state | `GET .../sessions/:sessionId/apprentice` | Voice, context, counts, pending question/guidance, finalization state |
| Real conversation | `GET .../sessions/:sessionId/events?before=<eventId>` | `{items, nextCursor}`; newest 100 apprentice events in chronological order |

Every route except login requires the demo bearer token. No admin session API
key or provider key is sent to the browser. Session events enforce the existing
session owner and organization checks. The events route reads the existing
SessionEvent table and needs no database migration.

## UI mapping

- `Auth`: real demo login and API errors. `/auth/me` restores/verifies identity.
- `Dashboard`: actual organization workflows, knowledge counts, and own sessions.
- `NewSession`: create/reuse a workflow, then start an expert Meet session.
- `LearnerSetup`: select a READY workflow and start an employee Meet session.
- `SessionLive` (shared by `LiveCapture` / `LearnerLive`): poll session, media,
  apprentice state, and saved events every two seconds. This observes the live
  backend AI pipeline; it does not process media after the meeting.
- `WorkMap`: actual saved `definition.apprentice.context` and `knowledge`, with
  expert transcript evidence. Legacy definitions can be inspected as JSON.
- `LearnerSummary`: recorded guidance, corrections, knowledge, and closing
  progress context; older history can be loaded with the event cursor.

Recall requests admission from the meeting URL; the API does not return an
invitation email. Sharing screens and talking to Ari happen inside Google Meet.
Mock tutor chat, fabricated map health/mastery, manual publishing, and fake
processing timers have been removed from the connected UI. No chat or manual
Work Map edit endpoint is currently exposed by the backend.

Hash routes preserve workflow/session IDs across reloads. The backend must also
stay running for live speech context. RTK polling shows server updates without
needing a second browser WebSocket connection.
