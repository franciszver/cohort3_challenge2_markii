<!-- SaturdayRush consolidated plan: merges AI_Assistant.md + OpenAI.Swarm.md -->
## Saturday Rush — Assistant Plan (Flag-Gated, Non‑Breaking)

### Goals
- Improve assistant replies using OpenAI while preserving existing behavior behind flags.
- Provide calendar events, recipe suggestions, and memory (preferences/lists) reliably.
- Add new capabilities: event conflict warnings, decision summarization, priority highlighting, RSVP tracking, deadline extraction.
- Allow the assistant chat to include multiple participants (group assistant chat) with add participants flow.

### Quick Links
- Architecture: [Assistant_Architecture.md](/_docs/Assistant_Architecture.md)
- Project summary: [Project_Completion_Summary.md](/_docs/Project_Completion_Summary.md)

### Prioritized Execution Plan (Non‑Breaking, Flag‑Gated)
1) Decision Summarization (ASSISTANT_DECISIONS_ENABLED)
   - Required AI feature; backend‑only; low blast radius; easy to validate.
2) Event Conflict Warnings (ASSISTANT_CONFLICTS_ENABLED)
   - Assistant‑only awareness from prior chat events; simple append‑warning; pairs with priorities.
3) Priority Highlighting (ASSISTANT_PRIORITY_ENABLED)
   - Required AI feature; add conflict‑based high‑priority entries; minimal UI (badge + modal).
4) RSVP Tracking (ASSISTANT_RSVP_ENABLED)
   - Required AI feature; regex + author mapping; chips UI under CTA; moderate effort.
5) Deadline Extraction (ASSISTANT_DEADLINES_ENABLED)
   - Required AI feature; date parsing + validation; CTA to reminder/calendar; moderate effort.
6) Group Assistant Chat (ASSISTANT_GROUP_ENABLED)
   - Client/UI change; add participants; history paging; notify joins; gated to avoid regressions.
7) Docs (last; update after features stabilize)
   - UpdateREADME, DevSetup guide.

### Requirement Status (at‑a‑glance)
- [Completed] Conversation history retrieval (RAG pipeline)
- [Completed] User preference storage
- [Completed] Function calling capabilities
- [Completed] Memory/state management across interactions
- [Completed] Error handling and recovery

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

### AI Framework Implementation & Compliance
- [Completed] Conversation history retrieval (RAG pipeline)
  - Lambda retrieves the last ~10 messages per conversation for prompt context and logic decisions.
- [Completed] User preference storage
  - Preferences are written/read via SYSTEM messages with `metadata.type='preferences'` and attachment sentinels; merged forward across interactions.
- [Completed] Function calling capabilities
  - Goal (met, non‑strict sense): enable the assistant to invoke “tools” to produce consistent, template‑like outputs.
  - Today: deterministic server‑side functions (fetchRecentMessages, load/save preferences via SYSTEM messages, fetchRecipes, emit events metadata) are invoked by the Lambda based on intent/flags with strict JSON I/O. This yields consistent results without relying on model‑directed tool selection.
  - Calendar writes remain a client CTA by design (permissions/user consent). The assistant emits `events[]`; the app handles add‑to‑calendar on user action.
  - Planned: optional explicit OpenAI tool‑calling or framework integration (Vercel AI SDK/Swarm/LangChain) behind a flag, without changing client contracts.
- [Completed] Memory/state management across interactions
  - Message-based memory (preferences, lists) and idempotency (request dedup) provide continuity across turns without new schema dependencies.
- [Completed] Error handling and recovery
  - Strict JSON validation, bounded timeouts (OpenAI 6s; recipes ~3.5s), attachment sentinel fallbacks, metadata refetch retries, and a safe weekend‑template fallback ensure graceful degradation.

### Executive Summary (Framework Choice)
- We met the functional requirements using a lean, flag-gated Lambda “mini-agent” instead of a heavy framework. This keeps latency low, avoids regressions, and fits our current surface area:
  - Conversation context and memory are implemented via GraphQL reads and SYSTEM message metadata; no schema changes required.
  - Capabilities (recipes, calendar events, preferences/lists) are deterministic server tools exposed inside the Lambda with strict JSON interfaces.
  - Robust fallbacks guarantee the app behaves identically when flags are off or external calls fail.
- Migration path is straightforward if leadership wants a named framework:
  - OpenAI function-calling can replace the current JSON contract without changing client UI.
  - Vercel AI SDK, Swarm, or LangChain can orchestrate the same tools behind the existing flags; the attachment/metadata contracts and mobile CTAs remain unchanged.

### New Work — Detailed (Flag‑Gated)
All new features must be fully reversible via flags, validate strict JSON, and degrade gracefully (omit metadata when validation fails). Attach a sentinel string as a client fallback.

1) Event Conflict Warnings (`ASSISTANT_CONFLICTS_ENABLED`)
- Backend: aggregate known events from recent assistant messages (parse `metadata.events` and `events:{...}` attachments), detect overlaps with newly proposed `events[]`, and append a warning line in the reply (e.g., “You already have Y that day; clarify times?”).
- Mobile: no device calendar access required; calendar CTA remains unchanged.
- Metadata (optional): include `metadata.conflicts = [{ eventIndex, conflicts:[{ title, startISO, endISO, source:'assistant' }] }]`; sentinel `conflicts:{...}` as a fallback.
- Acceptance: assistant warns about conflicts with prior chat events; adding to calendar is still allowed.

2) Decision Summarization (`ASSISTANT_DECISIONS_ENABLED`)
- Backend (OpenAI): extract `decisions[]` from recent messages: `{ title, summary, participants[], decidedAtISO }`.
- Metadata/sentinel: `metadata.decisions`, `decisions:{...}`.
- Mobile UI: “View decisions” CTA under assistant messages; modal lists decisions and participants.
- Trigger: when enabled, attempt extraction on assistant replies; use lightweight keyword heuristics (e.g., “we decided”, “let’s go with”) to suppress empty/noisy outputs.
- Participants: derive from message authors’ `userId`; client maps to display names for rendering.
- Flag: default off.
- Acceptance: group consensus captured with time and participants; appears within ≤8s end‑to‑end.

3) Priority Highlighting (`ASSISTANT_PRIORITY_ENABLED`)
- Backend (OpenAI): extract `priorities[]` with `{ item, level:'low'|'medium'|'high', reason, dueISO? }`.
- Metadata/sentinel: `metadata.priorities`, `priorities:{...}`.
- Mobile UI: subtle “Urgent” badge/stripe on relevant assistant messages; optional list in a modal.
- Conflict tie‑in: when both conflicts and priorities are enabled, automatically add a `high` priority entry for each conflicting event with `reason: "Conflicts with <other event>"` and `dueISO: event.startISO`; reference the same `eventIndex` used in `metadata.conflicts`.
- Flags: linkage is active only when `ASSISTANT_CONFLICTS_ENABLED` and `ASSISTANT_PRIORITY_ENABLED` are both on.
- Acceptance: urgent items visibly surfaced; no layout regressions.

4) RSVP Tracking (`ASSISTANT_RSVP_ENABLED`)
- Backend: for recent/future `events[]`, derive RSVPs from chat replies per user: `userId -> yes|no|maybe` (simple regex and author mapping), and keep updating on new messages.
- Metadata/sentinel: `metadata.rsvps = [{ eventIndex, responses:{ [userId]: 'yes'|'no'|'maybe' } }]`, `rsvps:{...}`.
- Mobile UI: inline chips (Yes/No/Maybe) under the calendar CTA for each event, with counts.
- Disambiguation: if multiple events are nearby, default to the nearest upcoming event unless the message mentions an event title keyword.
- Updates: subsequent replies by the same user overwrite their prior response for that event (latest wins).
- Flag: default off.
- Acceptance: RSVP counts accurate when users reply naturally in chat; updates within ≤8s.

5) Deadline Extraction (`ASSISTANT_DEADLINES_ENABLED`)
- Backend (OpenAI): extract `{ title, dueISO, ownerId?, notes? }` from chat mentions of commitments.
- Metadata/sentinel: `metadata.deadlines`, `deadlines:{...}`.
- Mobile UI: “Add reminder” or “Add to calendar” CTA per deadline; due date rendering.
- Trigger: when enabled, detect keywords like “due”, “by EOD”, “deadline”, and natural date phrases; validate ISO and discard low‑confidence items.
- Ownership: set `ownerId` when stated; otherwise omit and render as “Unassigned”.
- Flag: default off.
- Acceptance: deadlines identified with correct date/time and optional owner.

6) Group Assistant Chat (`ASSISTANT_GROUP_ENABLED`)
- Enable assistant conversations to be group chats (assistant included as a participant).
- Mobile: add “Add participants” action in chat header when the assistant conversation is open; use existing group conversation patterns to include additional users after creation.
- Assistant membership: the assistant always remains a participant and cannot be removed.
- Conversation origin: this is the same assistant chat created when pressing the Assistant button; we extend it by adding participants.
- History visibility: show the last 50 messages initially; when a user scrolls up, fetch and temporarily show older messages (paged). New participants can view full history, subject to pagination.
- Notifications: send a SYSTEM message notifying newly added users that they were added (and by whom).
- Backend: assistant continues to summarize last ~10 messages; decisions/RSVPs/priorities reference `userId` correctly.
- Flag: ship behind `ASSISTANT_GROUP_ENABLED` (default off).
- Acceptance: able to add 1–N users; assistant remains present; last-50 + paginate works; newly added users receive a notification; no regressions to 1:1/chat list.

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

### Required Deliverables
- Demo Video (5–7 min) — Task: DemoVideo
  - Goal: Demonstrate advanced assistant features and briefly explain the architecture.
  - Script outline:
    1) Intro (0:30)
       - State app name and persona (family planning assistant).
       - Mention that features are flag‑gated to avoid regressions.
    2) Setup (0:30)
       - Show `.env` flags: `ASSISTANT_ENABLED=true`, `ASSISTANT_CALENDAR_ENABLED=true`.
       - Mention Lambda flags `ASSISTANT_OPENAI_ENABLED` / `ASSISTANT_RECIPE_ENABLED` already enabled.
    3) Assistant conversation (1:00)
       - Tap Assistant button to open the assistant chat.
       - Send a message (e.g., “Plan our weekend around a farmers market”).
       - Show assistant reply with compact text and `Add to calendar` CTA.
    4) Calendar events CTA (0:45)
       - Tap CTA; choose a target calendar if prompted; show success toast.
       - Mention events are emitted as `metadata.events` and fallback `events:{...}` sentinel.
    5) Preferences and lists (0:45)
       - Send “Set preferences: vegetarian=true, budget=low”. Show assistant ack.
       - Send “Save list Groceries: apples, milk, bread”. Show “Show list Groceries”.
    6) Dinner suggestions (1:00)
       - Ask “What’s for dinner with tomatoes?”
       - Show “View recipes” CTA and modal (titles, ingredients, steps).
       - Note preferences influence results; retrieval time‑boxed (~3.5s).
    7) Reliability & fallback (0:30)
       - Briefly toggle `ASSISTANT_OPENAI_ENABLED=false` and resend a prompt to show the safe weekend template still emits calendar events.
    8) Architecture overview (0:45)
       - Open `Assistant_Architecture.md` Mermaid diagrams.
       - Explain: Mobile → API Gateway → Lambda → AppSync/DynamoDB; optional OpenAI/Themealdb via flags.
       - Call out strict JSON validation, timeouts, idempotency.
    9) Close (0:30)
       - Summarize: flags, events CTA, recipes, preferences/lists, fallbacks; upcoming features (conflicts, decisions, priorities, RSVPs, deadlines).

### Repository & Setup (Docs Tasks)
- README — Task: UpdateREADME
  - Add Quickstart (clone, install, env files, run mobile, deploy Lambda via deploy.ps1).
  - Document feature flags (mobile + Lambda) and links to `Assistant_Architecture.md`, `SaturdayRush.md`, `Project_Completion_Summary.md`.
  - Note demo video link placeholder.
- Developer Setup Guide — Task: DevSetup
  - New doc `_docs/DEV_SETUP.md` with prerequisites (Node/Expo CLI, AWS CLI), AWS profile/region, env templates usage, deploy Lambda, run mobile (Expo Go/emulator), and troubleshooting.
  - Include minimal testing steps to verify events CTA and recipes modal.
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


