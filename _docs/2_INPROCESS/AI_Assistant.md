<!-- 295fc8bc-181a-4ba8-8483-cec2c9934223 dadf0bef-6777-402f-8d46-c50dbd4bace2 -->
# Weekend Planner Assistant (MVP)

## Scope

- Implement only the “Multi‑Step Agent: Plan weekend activities based on family preferences.”
- Dedicated AI chat (assistant conversation) with asynchronous server reply.
- No schema changes, no resolver/VTL modifications, no DynamoDB streams.
- Shipped behind a feature flag to guarantee no regressions.

## Architecture

- Mobile creates/opens a dedicated assistant conversation.
- When user sends a message in that conversation, client triggers an HTTPS endpoint (AWS Lambda) and returns immediately.
- Lambda:
- Pulls recent conversation history via AppSync `Query.listMessages` (RAG context, last N messages).
- Fetches/saves user preferences via `Mutation.updateUserProfile` and `Query.getUserProfile` (lightweight JSON fields).
- Manages “saved lists” server‑side (backend‑only), recallable by title and enumerable.
- Ingredient-based recipe flow (two-step, zero backend triggers):
1) Assistant prompts everyone to reply with `Ingredient: <item>`.
2) When someone later says “done”/“make a recipe”, agent reads recent messages, extracts each participant’s latest ingredient, and generates 1-2 dish options + grocery list.
- Calls OpenAI with function‑calling tools (preferences read/write, message fetch, saved list CRUD, optional lightweight time/date parsing, recipe generation).
- Posts the assistant reply through existing `Mutation.sendMessage` to the same conversation.
- Errors are isolated to Lambda; mobile UI remains intact.

## Data/Models

- Reuse existing `messages` and `user_profiles` tables.
- Store preferences and saved lists as nested JSON on the user profile (no migration):
- `user_profiles.savedLists: { [listId]: { title, type, items[] } }` plus a `title` index map for quick title lookup.
- Represent the assistant as a virtual user (e.g., `assistant-bot`) with a stable internal `userId`.

## Backend (Lambda agent)

- Location: `scripts/agent/` (extend `index.js` or add `assistant.js`).
- Expose `POST /agent/weekend-plan` via API Gateway; env vars for AppSync endpoint/region and OpenAI key.
- Tools (function calling):
- getRecentMessages(conversationId, limit=50)
- getUserPreferences(userId)
- saveUserPreferences(userId, preferences)
- createSavedList(userId, list)
- listSavedLists(userId, type?)
- updateSavedList(userId, listId, list)
- deleteSavedList(userId, listId)
- extractIngredientsFromMessages(messages)
- sendAssistantMessage(conversationId, text, structuredPayload?)
- Prompting: system prompt specialized for family weekend planning; model must output strict JSON for itineraries/lists/events/recipes; agent validates then posts friendly summaries.
- Observability: structured logs; idempotency via `requestId` to avoid duplicate messages/list writes.

## AppSync access from Lambda

- Use IAM‑signed HTTP requests to AppSync for GraphQL queries/mutations.
- Reuse mobile GraphQL shapes: `Query.listMessages`, `Mutation.sendMessage`, `Query.getUserProfile`, `Mutation.updateUserProfile`.

## Mobile changes

- Feature flag in `mobile/src/utils/flags.ts`: `ASSISTANT_ENABLED` (default false).
- Conversation entry point:
- Add “Assistant” row in `mobile/src/screens/ConversationListScreen.tsx` (flag‑gated) to open/create the assistant conversation.
- Chat behavior in `mobile/src/screens/ChatScreen.tsx`:
- On send (assistant conversation only), call the agent endpoint; UI remains responsive.
- Show transient “Assistant is thinking…” typing indicator until reply lands via normal subscriptions.
- Floating Help
- Add a bottom‑right floating `?` button (flag‑gated) in `ConversationListScreen.tsx` and `ChatScreen.tsx`.
- Tapping shows a modal: how to ask for plans; how to save/recall lists by title; ingredient collection (`Ingredient: tomato`), and optional calendar add.
- Config: add agent endpoint base URL in `mobile/src/aws.ts` or `.env`.

## RAG pipeline (simple, safe)

- Retrieve last 30–50 messages as conversational context; include user preferences and saved list titles in the system context.
- Use rule-based extraction for `Ingredient:` replies; defer vector DB.

## Calendar integration (optional)

- Assistant emits structured `events[]` in the JSON payload.
- Mobile shows an “Add to calendar” CTA; on tap, writes to device calendar via Expo `expo-calendar` (permissions flow).
- Guarded by `ASSISTANT_CALENDAR_ENABLED` sub‑flag.

## Error handling

- Graceful timeouts and OpenAI/API errors produce a helpful assistant message with retry guidance.
- Circuit breaker on repeated failures; log with correlation IDs.

## Security & secrets

- OpenAI API key stored in AWS Secrets Manager; local dev via env var.
- Least‑privilege IAM for AppSync access.

## Documentation deliverables

- `_docs/6_MVP_COMPLETE/assistant_mvp_overview.md`: what was built, how to use it, architecture details (tools + RAG + integration), flags, and ops notes.
- `_docs/6_MVP_COMPLETE/assistant_mvp_manual_testing.md`: end‑to‑end manual test steps, expected outputs, edge cases, and demo script.

## Rollout

- Feature flags off by default; internal dogfood first.
- Logging only (no PII metrics); enable per‑user or build‑time when stable.

## Roadmap (post‑MVP)

- Add smart calendar extraction, decision summaries, RSVP tracking, priority highlights, and deadlines extraction.
- Consider DynamoDB Streams trigger for auto‑reply to reduce client coupling.
- Add vector memory for longer‑term preferences.

### To-dos

- [x] Add ASSISTANT_ENABLED feature flag in mobile and default to false (local override true)
- [x] Add Assistant entry in ConversationList to open/create bot conversation
- [x] Create AWS Lambda HTTP endpoint in `scripts/agent` for weekend planner (POST /agent/weekend-plan)
- [x] Implement GraphQL client in Lambda for listMessages/createMessage (IAM or JWT pass-through)
- [ ] Implement OpenAI tool-calling logic with RAG over recent messages (post-MVP)
- [x] From ChatScreen, call agent endpoint after user sends message in assistant chat
- [x] Show transient "Assistant is thinking…" until assistant reply arrives
- [x] Add resilient error handling and user-visible fallback messages
- [ ] Store OpenAI key in Secrets Manager; configure IAM for AppSync (post-MVP, not needed for single-tool)
- [x] Test end-to-end behind flag; enable for limited users

### Status (Executed)

- Assistant chat is feature-flagged and working end-to-end.
- Lambda receives the request, reads recent messages, and replies with a simple weekend plan template.
- Replies are posted via AppSync `createMessage` as `assistant-bot`; frontend subscriptions display them.
- Added a Getting Started modal (flag-gated “?”) with example prompts.
- Robust logging in both client and Lambda; JWT pass-through supported.

### Next Steps

1. Replace the fixed template with OpenAI-generated summaries and options (tool-calling; same getRecentMessages tool).
2. Add preferences read/write tools and simple saved-lists (server-side only).
3. Optional: calendar export (emit `events[]` payload; add Expo calendar CTA).
4. Harden ops: move secrets to Secrets Manager; least-privilege IAM; per-env configs.