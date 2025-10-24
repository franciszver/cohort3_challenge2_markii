<!-- assistant-mvp-single-tool-plan v1 -->
### Assistant MVP: Single-Tool Plan (Echo via recent messages)

#### Objective
- Enable a user to chat with an “Assistant” and receive a simple reply, with minimal risk and zero schema/VTL changes.
- Implement exactly one backend tool: getRecentMessages(conversationId, limit), then post a canned echo reply via existing `createMessage`.
- Assistant is a virtual sender (`senderId='assistant-bot'`) and NOT a conversation participant.
- Expose a private (unlisted) HTTP endpoint for the agent; no auth for MVP.

#### Scope (MVP)
- Mobile
  - Feature flag `ASSISTANT_ENABLED` (default off).
  - Add an “Assistant” entry in conversation list (flag-gated) that opens a dedicated conversation `assistant::<userId>`.
  - On send in the assistant conversation: keep normal message send, then call the agent HTTP endpoint; show a transient “Assistant is thinking…” while waiting for the agent’s reply to arrive via subscription.
- Backend
  - New Lambda handler `scripts/agent/assistant.js` exposed as `POST /agent/weekend-plan` via API Gateway.
  - Single tool: `getRecentMessages(conversationId, limit=10)` using IAM-signed requests to AppSync `messagesByConversationIdAndCreatedAt`.
  - Generate minimal reply: “Assistant Echo: I saw ‘<last user message>’. I’ll be smarter soon.”
  - Post reply via `createMessage` with `senderId='assistant-bot'`.
  - Idempotency: optional `requestId` to avoid duplicates on retries.

#### Non-Goals (MVP)
- No schema, VTL, DynamoDB Stream triggers, or OpenAI calls.
- No user or profile creation for the assistant.
- No endpoint authentication (kept private/unlisted).

#### Architecture
- Mobile (Expo/Amplify) → API Gateway (private URL) → Lambda (`assistant.js`) → AppSync GraphQL (IAM-signed).
- Subscriptions already in the app will pick up the assistant’s reply.

#### Data/Models
- Reuse existing `Conversation`, `Message` models.
- Assistant conversation id: `assistant::<userId>`.
- Participants list contains only the user (assistant is not a participant).
- Assistant messages use `senderId='assistant-bot'` and `messageType='TEXT'`.

#### Backend Implementation Details
- File: `scripts/agent/assistant.js`
- Environment
  - `AWS_REGION=us-east-1`
  - `APPSYNC_ENDPOINT=https://<appsync-api-id>.appsync-api.us-east-1.amazonaws.com/graphql`
  - `ASSISTANT_BOT_USER_ID=assistant-bot`
  - (Optional) `ASSISTANT_REPLY_PREFIX="Assistant Echo:"`
- Endpoint: `POST /agent/weekend-plan`
  - Request JSON: `{ requestId?: string, conversationId: string, userId: string, text: string }`
  - Response JSON: `{ ok: true }` (returns quickly; reply is posted asynchronously)
- Single Tool (IAM-signed to AppSync):
  1) `getRecentMessages(conversationId, limit=10)` → `Query.messagesByConversationIdAndCreatedAt` (DESC)
  2) `createMessage(conversationId, content, senderId='assistant-bot')`
- Logic
  1) Validate payload; compute `echoTarget` as the user’s last message content if present, else current `text`.
  2) Build content: `${ASSISTANT_REPLY_PREFIX} I saw ‘${echoTarget}’. I’ll be smarter soon.`
  3) Post via `createMessage`.
  4) On any error, log and exit 200 with `{ ok: true, warn: true }` (no user-visible regression).
- Idempotency
  - If `requestId` set, keep a short-lived in-memory map (best-effort) to ignore duplicate calls in the same container lifespan.
  - For MVP we skip durable dedupe.
- Observability
  - Structured logs: `requestId`, `conversationId`, `userId`.
  - Timeouts: set 2–3s for AppSync HTTP calls.
- IAM
  - Lambda execution role needs `appsync:GraphQL` on the API.
  - Minimal policy example (reference for IaC):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["appsync:GraphQL"],
      "Resource": [
        "arn:aws:appsync:us-east-1:<account-id>:apis/<appsync-api-id>/*"
      ]
    }
  ]
}
```

#### API Contract (for mobile)
- `POST {ASSISTANT_ENDPOINT}/agent/weekend-plan`
  - Headers: `Content-Type: application/json`
  - Body:
    - `conversationId: string` (the `assistant::<userId>` id)
    - `userId: string` (current user)
    - `text: string` (the user’s just-sent message)
    - `requestId?: string` (optional, for idempotency)
  - Response: `{ ok: true }` (agent reply will arrive via GraphQL subscription)

#### Mobile Implementation Details
- Flags (`mobile/src/utils/flags.ts` + `mobile/app.config.ts`):
  - Add `ASSISTANT_ENABLED` (default `false`).
  - Add `ASSISTANT_ENDPOINT` in `extra` and `.env.example`.
- Conversation List (`mobile/src/screens/ConversationListScreen.tsx`):
  - When `ASSISTANT_ENABLED` is true: render a top-row “Assistant”.
  - On tap: ensure/create conversation id `assistant::<myUserId>` with participants `[myUserId]`, name “Assistant”, then navigate to Chat.
- Chat Screen (`mobile/src/screens/ChatScreen.tsx`):
  - Detect assistant conversation by id prefix `assistant::`.
  - On send: keep existing `sendTextMessageCompat`, then make a non-blocking POST to `{ASSISTANT_ENDPOINT}/agent/weekend-plan` with `{ conversationId, userId, text, requestId }`.
  - Show “Assistant is thinking…” until the next inbound message is received in that conversation.

#### Configuration / .env
- `.env` (local dev):
  - `AWS_REGION=us-east-1`
  - `APPSYNC_ENDPOINT=https://<appsync-api-id>.appsync-api.us-east-1.amazonaws.com/graphql`
  - `COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX`
  - `COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX`
  - `COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
  - `ASSISTANT_ENABLED=true` (for your local test)
  - `ASSISTANT_ENDPOINT=https://<api-id>.execute-api.us-east-1.amazonaws.com/prod` (to be provided after deploy)

#### Manual Test Plan (MVP)
1) Set flags: `ASSISTANT_ENABLED=true`, configure `ASSISTANT_ENDPOINT`.
2) Launch app, navigate to Conversations.
3) Tap “Assistant” → opens `assistant::<yourUserId>` chat.
4) Send “Hello world”.
5) Expect the assistant reply within ~1–2s: `Assistant Echo: I saw ‘Hello world’. I’ll be smarter soon.`
6) Retry with a different message; verify new echo arrives.
7) Disable the flag → “Assistant” row disappears; no changes to normal chats.

#### Acceptance Criteria
- With the flag ON, the “Assistant” conversation is visible and openable.
- Sending a message triggers the agent and produces an assistant reply in the same conversation.
- No schema/VTL changes; normal chats unaffected.
- With the flag OFF, nothing in the UI changes.

#### Rollout & Ops
- Default OFF; enable for internal testing only.
- Logging only; no PII or metrics collection in MVP.
- If errors occur, the user still sees their own send; assistant reply may be missing (acceptable in MVP).

#### Future (post‑MVP)
- Replace canned echo with OpenAI function-calling; keep `getRecentMessages` as a tool.
- Add `sendAssistantMessage` helper for consistent metadata/typing.
- Add preferences read/write tools and “saved lists” storage.
- Optionally add assistant as a participant with a profile for richer UI.


