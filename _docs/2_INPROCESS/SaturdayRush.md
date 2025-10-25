<!-- SaturdayRush consolidated plan: merges AI_Assistant.md + OpenAI.Swarm.md -->
## Saturday Rush — Assistant Plan (Flag-Gated, Non‑Breaking)

### Goals
- Improve assistant replies using OpenAI while preserving existing behavior behind flags.
- Provide calendar events, recipe suggestions, and memory (preferences/lists) reliably.
- Add new capabilities: event conflict warnings, decision summarization, priority highlighting, RSVP tracking, deadline extraction.
- Allow the assistant chat to include multiple participants (group assistant chat) with add participants flow.

### Current State (Implemented)
- OpenAI replies (flag `ASSISTANT_OPENAI_ENABLED`): strict 6s timeout; validated JSON `{ text, events?[] }`; fallback to weekend template on failure.
- Events delivery: assistant emits `metadata.events` and `attachments:['events:{...}']`; mobile shows “Add to calendar” CTA; target calendar is chosen once and persisted; writes via `expo-calendar`.
- Recipe suggestions (flag `ASSISTANT_RECIPE_ENABLED`): detects dinner intent; Themealdb retriever (~3.5s); emits `metadata.recipes` and `recipes:{...}`; mobile shows “View recipes” modal (title, ingredients, steps).
- Preferences memory: “Set/Show preferences” via SYSTEM messages + attachment sentinels; preferences included in OpenAI prompting.
- Saved lists: “Save/Add/Show/List lists” via SYSTEM metadata + sentinels; assistant acks with readable summaries.
- Deploy & env: `scripts/agent/deploy.ps1` configures Lambda with `ASSISTANT_OPENAI_ENABLED`, `ASSISTANT_RECIPE_ENABLED`, `OPENAI_MODEL`, optional `OPENAI_SECRET_ARN`; example envs updated (`env.example.json`, `mobile/.env.example`).
- Performance/timeouts: AppSync ~4s; OpenAI ~6s; recipes ~3.5s.
  - New: mobile flags scaffolded for decisions/priorities/RSVPs/deadlines/conflicts/group; env placeholders added in `env.example.json` and `mobile/.env.example`. (completed)

### Feature Flags (existing + proposed)
- Mobile: `ASSISTANT_ENABLED`, `ASSISTANT_CALENDAR_ENABLED`.
- Lambda: `ASSISTANT_OPENAI_ENABLED`, `ASSISTANT_RECIPE_ENABLED`, `OPENAI_MODEL`, `OPENAI_SECRET_ARN|OPENAI_API_KEY`.
- New (proposed):
  - `ASSISTANT_CONFLICTS_ENABLED`: emit and render event conflict warnings.
  - `ASSISTANT_DECISIONS_ENABLED`: decision summarization (group consensus).
  - `ASSISTANT_PRIORITY_ENABLED`: priority highlighting.
  - `ASSISTANT_RSVP_ENABLED`: RSVP tracking for upcoming events.
  - `ASSISTANT_DEADLINES_ENABLED`: deadline extraction from chat.
  - `ASSISTANT_GROUP_ENABLED`: enable group assistant conversations and add‑participant UI.

### Architecture Overview
- Backend (Lambda `scripts/agent/assistant.js`):
  - Reads last ~10 messages (`messagesByConversationIdAndCreatedAt`), preferences from SYSTEM messages, and flags.
  - Phase 2: dinner intent → Themealdb retriever → post recipes.
  - Phase 1: OpenAI call → validated JSON → emit text + optional `events[]`.
  - Fallback: weekend template with `events[]`.
  - Always attach metadata plus sentinel strings for client fallback (e.g., `events:{...}`, `recipes:{...}`).
- Mobile (`ChatScreen.tsx`, `ConversationListScreen.tsx`):
  - Renders CTAs for calendar and recipes by checking `metadata` first, then attachment sentinels.
  - Calendar write via `expo-calendar` with persisted target calendar.
  - Recipes modal shows up to 3 items with ingredients and steps.

### Data Contracts (metadata shapes)
- Events: `metadata.events = [{ title, startISO, endISO, notes? }]`; attachment sentinel `events:{"events":[...]}`.
- Recipes: `metadata.recipes = [{ title, ingredients[], steps[] }]`; attachment sentinel `recipes:{"recipes":[...]}`.
- Preferences: `SYSTEM` messages with `metadata:{ type:'preferences', data:{...} }`; attachment `pref:{...}`; content token fallback `pref:{...}`.
- Lists: `SYSTEM` messages with `metadata:{ type:'list', id, title, items[] }`; attachment `list:{...}`; content token fallback.

### New Work — Detailed (Flag‑Gated)
All new features must be fully reversible via flags, validate strict JSON, and degrade gracefully (omit metadata when validation fails). Attach a sentinel string as a client fallback.

1) Event Conflict Warnings (`ASSISTANT_CONFLICTS_ENABLED`)
- Backend: when emitting `events[]`, also compute conflicts among newly proposed events (overlap by time) and mark `conflicts:[{ title, startISO, endISO, conflictsWith:[indices] }]`.
- Mobile: on calendar CTA render (and if calendar permission granted), read device calendar events in time windows around each assistant event and flag conflicts. Show a “Conflict” badge and a small list of overlaps.
- Metadata: `metadata.conflicts = [{ eventIndex, conflicts:[{ title, startISO, endISO, source:'device'|'assistant' }] }]`; sentinel `conflicts:{...}`.
- Acceptance: conflicting events show a warning before adding to calendar; adding still allowed.

2) Decision Summarization (`ASSISTANT_DECISIONS_ENABLED`)
- Backend (OpenAI): extract `decisions[]` from recent messages: `{ title, summary, participants[], decidedAtISO }`.
- Metadata/sentinel: `metadata.decisions`, `decisions:{...}`.
- Mobile UI: “View decisions” CTA under assistant messages; modal lists decisions and participants.
- Acceptance: group consensus captured with time and participants; appears within ≤8s end‑to‑end.

3) Priority Highlighting (`ASSISTANT_PRIORITY_ENABLED`)
- Backend (OpenAI): extract `priorities[]` with `{ item, level:'low'|'medium'|'high', reason, dueISO? }`.
- Metadata/sentinel: `metadata.priorities`, `priorities:{...}`.
- Mobile UI: subtle “Urgent” badge/stripe on relevant assistant messages; optional list in a modal.
- Acceptance: urgent items visibly surfaced; no layout regressions.

4) RSVP Tracking (`ASSISTANT_RSVP_ENABLED`)
- Backend: for recent/future `events[]`, derive RSVPs from chat replies per user: `userId -> yes|no|maybe` (simple regex and author mapping), and keep updating on new messages.
- Metadata/sentinel: `metadata.rsvps = [{ eventIndex, responses:{ [userId]: 'yes'|'no'|'maybe' } }]`, `rsvps:{...}`.
- Mobile UI: inline chips (Yes/No/Maybe) under the calendar CTA for each event, with counts.
- Acceptance: RSVP counts accurate when users reply naturally in chat; updates within ≤8s.

5) Deadline Extraction (`ASSISTANT_DEADLINES_ENABLED`)
- Backend (OpenAI): extract `{ title, dueISO, ownerId?, notes? }` from chat mentions of commitments.
- Metadata/sentinel: `metadata.deadlines`, `deadlines:{...}`.
- Mobile UI: “Add reminder” or “Add to calendar” CTA per deadline; due date rendering.
- Acceptance: deadlines identified with correct date/time and optional owner.

6) Group Assistant Chat (`ASSISTANT_GROUP_ENABLED`)
- Enable assistant conversations to be group chats (assistant included as a participant).
- Mobile: add “Add participants” action in chat header when assistant conversation is open; use existing group conversation patterns to include additional users.
- Backend: assistant continues to summarize last ~10 messages; decisions/RSVPs/priorities reference `userId` correctly.
- Acceptance: assistant chat supports multiple participants; adding users does not break current flows.

### Acceptance Criteria — Must‑Have
- Event conflict warnings: conflicts detected among assistant events and device calendar events; visible warning before add.
- Decision summarization: captures group consensus with participants and time; viewable in UI.
- Priority highlighting: urgent items surfaced clearly; no regressions.
- RSVP tracking: accurate per‑user responses for upcoming events.
- Deadline extraction: commitments identified with due dates and optional owners.
- Recipe suggestions: continue to work using preferences and recent chat; preferences can be updated via chat.
- Group assistant chat: add participants to assistant conversation without breaking existing functionality.

### Rollout & Safety
- Keep all new features behind flags listed above; default off.
- Validate JSON strictly and cap outputs; on any failure, omit feature metadata and keep existing behavior.
- Maintain attachment sentinel fallbacks (`events:{...}`, `recipes:{...}`, `decisions:{...}`, `priorities:{...}`, `rsvps:{...}`, `deadlines:{...}`, `conflicts:{...}`).
- Observe latency budget ≤8s end‑to‑end for assistant replies.

### Manual Steps
- Lambda: set env vars via `scripts/agent/deploy.ps1` with flags and `OPENAI_SECRET_ARN` or `OPENAI_API_KEY`.
- Mobile: set `ASSISTANT_ENABLED`, `ASSISTANT_ENDPOINT`, `ASSISTANT_CALENDAR_ENABLED` in `.env`; rebuild/reload.
- Permissions: ensure Secrets Manager `GetSecretValue` for Lambda; calendar permissions on device.

### Testing Checklist
- Events: metadata present and CTA renders; adding to selected calendar succeeds; conflicts appear when overlapping device events exist.
- Recipes: dinner intent produces 1–3 items; modal shows ingredients/steps.
- Preferences/lists: commands persist and are retrievable via SYSTEM metadata and sentinels.
- OpenAI fallback: simulate timeouts; weekend template + events still posted.
- Group chat: add a participant; assistant continues to function, decisions/RSVPs attribute to correct users.

### Completed vs Remaining
- Completed:
  - OpenAI JSON replies with events (flag‑gated), calendar CTA/write flow.
  - Dinner intent + recipes retriever + UI (flag‑gated).
  - Preferences and saved lists via SYSTEM metadata + sentinels.
  - Deploy script and example envs with new flags.
- Remaining (flag‑gated):
  - Event conflict warnings (`ASSISTANT_CONFLICTS_ENABLED`).
  - Decision summarization (`ASSISTANT_DECISIONS_ENABLED`).
  - Priority highlighting (`ASSISTANT_PRIORITY_ENABLED`).
  - RSVP tracking (`ASSISTANT_RSVP_ENABLED`).
  - Deadline extraction (`ASSISTANT_DEADLINES_ENABLED`).
  - Group assistant chat + add participants (`ASSISTANT_GROUP_ENABLED`).


