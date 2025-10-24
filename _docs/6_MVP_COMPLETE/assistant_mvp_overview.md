### Assistant MVP Overview (Single-Tool)

#### What was built
- Flag-gated “Assistant” chat that opens a dedicated conversation `assistant::<userId>`.
- On send, the mobile app calls a private agent endpoint.
- Lambda reads recent messages (single tool) and posts a canned echo reply via AppSync `createMessage` with `senderId='assistant-bot'`.

#### How to use
1) Enable `ASSISTANT_ENABLED=true` and set `ASSISTANT_ENDPOINT` in mobile `.env`.
2) Open “Assistant” in the Conversations list.
3) Send a message; an echo reply appears within a second or two.

#### Architecture
- Mobile → API Gateway (private URL) → Lambda (`scripts/agent/assistant.js`) → AppSync GraphQL.
- No schema or VTL changes.

#### Flags
- `ASSISTANT_ENABLED` (default false) — shows/hides assistant UI and send-hook.
- `ASSISTANT_ENDPOINT` — base URL of agent API.

#### Ops Notes
- Lambda requires `appsync:GraphQL` on API `<appsync-api-id>` in `us-east-1`.
- Logs include `requestId`, `conversationId`, `userId`.
- Endpoint is unauthenticated in MVP; keep URL private.


