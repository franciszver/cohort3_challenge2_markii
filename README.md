# NegotiatedAi – Chat + Assistant (Expo + AppSync)

Android-first chat application with a flag-gated "Assistant" powered by an AWS Lambda. The mobile app is built with React Native + Expo and talks to AWS Cognito for auth and AWS AppSync (GraphQL) for data. The Assistant Lambda can optionally call OpenAI for compact plans and adds structured metadata (decisions, events, conflicts) to messages.

This repository includes:
- Mobile app (`mobile/`)
- AppSync GraphQL schema (`schema.graphql`) and example VTL resolvers (`_docs/appsync/resolvers/`)
- Assistant Lambda and deployment script (`scripts/agent/`)
- Utilities and notes for pushing schema and infra (`scripts/`, `_docs/infra/`)

## Repository layout

- `mobile/` – Expo app (entrypoints: `index.ts`, `App.tsx`, config: `app.config.ts`)
  - `src/aws.ts` – Amplify client configuration (Cognito + AppSync)
  - `src/screens/` – Auth, Conversation list, Chat, Group create, Forgot password flow
  - `src/graphql/` – AppSync client functions for conversations/messages/users/profile
  - `src/utils/` – flags, theme, time, nicknames, notifications
- `schema.graphql` – Root GraphQL schema (Conversations, Messages, Users, Profiles)
- `_docs/appsync/resolvers/` – Example VTL for UserProfile and legacy list/send
- `scripts/agent/` – Assistant Lambda (`assistant.js`) and PowerShell deploy (`deploy.ps1`)
- `scripts/push-schema.js` – Pushes `schema.graphql` to AppSync via AWS CLI
- `_docs/6_MVP_COMPLETE/` – Architecture and MVP notes/testing

## Architecture

- Client: Expo React Native app using `aws-amplify` (Auth + GraphQL)
- Auth: Cognito User Pools + Identity Pool (IDs provided via `.env` → `app.config.ts` → Constants.extra)
- API: AppSync GraphQL
  - Queries/Mutations for Conversations, Messages, Users, UserProfile
  - Subscriptions for message delivery, receipts, typing, presence
- Data: DynamoDB tables behind AppSync (Amplify/AppSync-managed)
- Assistant: API Gateway HTTP API → Lambda (`assistant-mvp`) → AppSync GraphQL
  - Posts assistant replies as user `assistant-bot`
  - Optional OpenAI call for compact JSON planning
  - Attaches structured metadata (events, decisions, conflicts) to messages

See detailed diagrams and notes in `_docs/6_MVP_COMPLETE/mvp_architecture.md` and `_docs/6_MVP_COMPLETE/assistant_mvp_overview.md`.

## Prerequisites

- Node.js 18+ and npm
- Expo CLI (npx is fine)
- AWS CLI v2 configured (`AWS_PROFILE` and default region)
- Existing AWS resources: Cognito User Pool + Client, Identity Pool, AppSync API

## Mobile setup and run

1) Create `mobile/.env` with your environment. Example:

```env
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_xxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxx
COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
APPSYNC_ENDPOINT=https://<appsync-api-id>.appsync-api.us-east-1.amazonaws.com/graphql

# Optional product flags (see Flags section)
ASSISTANT_ENABLED=true
ASSISTANT_ENDPOINT=https://<your-api-id>.execute-api.us-east-1.amazonaws.com/prod
ENABLE_CONVERSATION_LIST_UX=true
ENABLE_AUTH_UX=true
```

2) Install and run the app:

```bash
cd mobile
npm install
npx expo start
```

Notes:
- `app.config.ts` loads `.env` automatically via `dotenv/config` and exposes values in `Constants.expoConfig.extra`.
- Push notifications: the app registers Expo push tokens only on a dev client or standalone build; Expo Go will log and skip remote registration.

## AppSync schema and resolvers

- Root schema lives at `schema.graphql` and includes Conversations, Messages, MessageReads, Users, UserProfile, and custom helpers (typing, lookups).
- Push the schema to an existing AppSync API:

```powershell
# Set your AWS CLI context
$env:AWS_PROFILE = 'my-aws-profile'

# From repo root
node scripts/push-schema.js --api-id=<APPSYNC_API_ID>
```

- UserProfile VTL examples are under `_docs/appsync/resolvers/`.
  - Attach to `Query.getUserProfile` and `Mutation.updateUserProfile` in AppSync console if you are not using Amplify-generated resolvers.
- If you need to read/write `Message.metadata` on assistant messages and see nulls in mobile, review `_docs/2_INPROCESS/Option2_AppSyncMetadataPermissionsFix.md` for field-level auth options.

## Assistant backend (Lambda) – deploy

The Assistant is a single Lambda that reads recent messages and posts a reply as `assistant-bot`. It can also call OpenAI for compact planning and tag decisions, events, and conflicts.

Deploy (PowerShell):

```powershell
pwsh -File scripts/agent/deploy.ps1 `
  -Profile my-aws-profile `
  -Region us-east-1 `
  -AppSyncApiId <APPSYNC_API_ID> `
  -AppSyncEndpoint https://<appsync-api-id>.appsync-api.us-east-1.amazonaws.com/graphql `
  -EnableOpenAI `
  -EnableDecisions `
  -EnableRecipes `
  -DebugLogs
```

Outputs include the HTTP API base URL. Set that as `ASSISTANT_ENDPOINT` in `mobile/.env`.

### OpenAI configuration

Configure the Lambda to access OpenAI using one of:

1) Inline API key
- Pass `-OpenAIApiKey <key>` to `scripts/agent/deploy.ps1` (sets `OPENAI_API_KEY`).

2) AWS Secrets Manager
- Pass `-OpenAISecretArn arn:aws:secretsmanager:<region>:<account-id>:secret:<name>`.
- Lambda reads the secret and uses `apiKey` or `OPENAI_API_KEY` or `key` if present.

If both are provided, the inline `OPENAI_API_KEY` takes precedence.

### Assistant feature flags

- `ASSISTANT_OPENAI_ENABLED` – Allow OpenAI calls in Lambda.
- `ASSISTANT_RECIPE_ENABLED` – Enable simple dinner recipe flow.
- `ASSISTANT_DECISIONS_ENABLED` – Extract/attach decisions metadata to assistant messages and include a `decisions:{...}` attachment sentinel.
- `ASSISTANT_PRIORITY_ENABLED` – Mark urgent requests via metadata.priority.
- `ASSISTANT_CONFLICTS_ENABLED` / `ASSISTANT_CALENDAR_CONFLICTS_ENABLED` – Detect time overlaps between proposed events, prior assistant events, and device calendar (device events are passed from mobile).

How to enable:
- Backend (deploy): pass the corresponding switches to `scripts/agent/deploy.ps1`.
- Backend (env): set env vars to `true` in Lambda configuration (see `env.example.json`).
- Mobile: set flags in `mobile/.env` (see `app.config.ts` → `extra`).

## Mobile features overview

- Auth flow (sign up, sign in, verify, forgot password linear or step screens)
- Conversation list with cached SWR, search, unread badge, foreground notifications
- Chat screen with message list, sending, receipts, typing
- Optional Assistant entry point (row and FAB) when `ASSISTANT_ENABLED=true`
- Profile modal (flag-gated) backed by `UserProfile` resolvers

Key files:
- `mobile/src/screens/ConversationListScreen.tsx` – list, subscriptions, notifications
- `mobile/src/screens/AuthScreen.tsx` – auth UX and validations
- `mobile/src/graphql/messages.ts` – list/send/subscribe helpers (root + fallbacks)
- `mobile/src/graphql/conversations.ts` – conversation create/list/update helpers
- `mobile/src/graphql/users.ts` – presence, push token, lookups
- `mobile/src/graphql/profile.ts` – profile read/update and cache

## Troubleshooting

- Metadata on assistant messages is null
  - Ensure AppSync permissions allow reading `Message.metadata` (see `_docs/2_INPROCESS/Option2_AppSyncMetadataPermissionsFix.md`).
- Assistant replies not posting
  - Verify Lambda has `appsync:GraphQL` permission for your API (script configures this) and that `APPSYNC_ENDPOINT` is correct.
- Expo push token missing in logs
  - Expo Go skips remote registration; use a dev client or standalone build to test push tokens.
- Mobile cannot authenticate
  - Confirm `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, and `COGNITO_IDENTITY_POOL_ID` in `mobile/.env` and that region matches.

## Useful docs

- `_docs/6_MVP_COMPLETE/assistant_mvp_manual_testing.md` – End-to-end Assistant test steps
- `_docs/6_MVP_COMPLETE/assistant_mvp_overview.md` – Assistant MVP behavior and flags
- `_docs/6_MVP_COMPLETE/mvp_architecture.md` – Architecture diagram and notes
- `_docs/appsync/README.md` – Notes on attaching UserProfile resolvers

## GraphQL operations (used by mobile)

Defaults assume region `us-east-1` and an unauthenticated Assistant HTTP API.

- Conversations
  - Query: `conversationParticipantsByUserIdAndConversationId(userId, limit, nextToken)` – list conversation IDs for a user
  - Query: `listConversations(filter: { participants: { contains: $userId } })` – fallback discovery by participants array
  - Query: `getConversation(id)` – details and last message preview fields
  - Mutation: `createConversation(input)` – creates a conversation, sets `participants`
  - Mutation: `createConversationParticipant(input)` – adds a participant with `joinedAt` and `role`
  - Mutation: `updateConversation(input)` – updates `name`, `lastMessage`, `lastMessageAt`, `lastMessageSender`
  - Subscription: `onDeleteConversation(filter: { id: { eq } })`

- Messages
  - Query: `messagesByConversationIdAndCreatedAt(conversationId, limit, nextToken, sortDirection)` – paginated list (DESC)
  - Query: `getMessage(id)` – fetch single message including `metadata`
  - Mutation: `createMessage(input)` – send a text message; attachments/metadata optional
  - Mutation: `updateMessage(input)` – patch fields (e.g., `metadata`)
  - Subscription: `onMessageInConversation(conversationId)` – real-time messages in a conversation
  - Subscription: `onCreateMessage(filter: { conversationId: { eq } })` – alternate subscription

- Receipts
  - Query: `messageReadsByMessageIdAndUserId(messageId, userId)` – get a specific receipt
  - Mutation: `createMessageRead(input)` – mark delivered/read (simple upsert pattern)
  - Mutation: `updateMessageRead(input)` – update a receipt
  - Subscription: `onCreateMessageRead(filter: { userId: { eq } })`

- Typing
  - Mutation: `sendTyping(conversationId, userId)` – emits typing event
  - Subscription: `onTypingInConversation(conversationId)`

- Users
  - Query: `getUser(id)` – user profile
  - Mutation: `updateUser(input)` – used for `lastSeen` and `pushToken`
  - Subscription: `onUpdateUser(filter: { id: { eq } })` – presence updates

- Profiles
  - Query: `getUserProfile(userId)` – via VTL resolver (see docs)
  - Mutation: `updateUserProfile(input)` – writes profile; resolver sets `createdAt` if missing

## License

Internal project for cohort3 challenge work. See repository history for details.
