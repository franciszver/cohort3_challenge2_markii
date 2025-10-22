# Epic 2 Summary

## What changed
- Aligned mobile client GraphQL to root `schema.graphql`:
  - Switched to `createMessage`, `messagesByConversationIdAndCreatedAt`, and a filtered `onCreateMessage` subscription.
- Refactored `ChatScreen` to use the new API and add offline behavior:
  - Optimistic send with local PENDING state.
  - AsyncStorage-backed history per conversation: `history:<conversationId>`.
  - Outbox queue per conversation: `outbox:<conversationId>`; drained on reconnect/app resume.
  - Live subscription updates merge into history and replace optimistic messages when server confirms.
- Kept UI minimal (message list, input, send) to focus on correctness and reliability first.
 - Client now subscribes to `onMessageInConversation`; incoming messages are marked delivered client-side.
 - Added typing indicators (emit/subscribe) and read receipt triggers.
 - Added image messages (URL-based for MVP) with thumbnail rendering and outbox support.
 - Foreground notifications via Expo for new messages when chat not focused.
 - Hardening: outbox retry with exponential backoff and paginated history loading.

## Why these changes
- Requirements call for real-time delivery, offline persistence, and resilience under poor networks and app restarts. An outbox + cached history ensures messages are not lost and appear immediately.
- Aligning the client to the root schema enables both 1:1 and group messaging paths and leverages existing queries for pagination and ordering.
- Subscription filtering by `conversationId` reduces bandwidth and complexity, scaling for both 1:1 and multi-user chats.
 - Added conversation-scoped subscription `onMessageInConversation` in schema to simplify client subscriptions per conversation.

## Follow-ups (next steps)
- Backend subscription enhancement: add conversation-scoped subscription (`onMessageInConversation`) or keep using filtered `onCreateMessage`.
 - Schema updated: added `onMessageInConversation` and extended `MessageRead` with optional `deliveredAt` for delivery receipts.
 - Typing events added (`sendTyping`, `onTypingInConversation`) using a NONE-like pattern in schema; client-only for MVP.
- Delivery/read receipts: add `DELIVERED` handling and persist `MessageRead` for `READ` state.
- Presence and typing indicators: heartbeat-based presence updates and a NONE-datasource typing mutation/subscription.
- Media messages: S3 pre-signed upload + `messageType=IMAGE` with attachment key.
- Optional: migrate cache to SQLite for large histories and advanced pagination.
 - Implement presence heartbeat/typing, image messaging via S3, and notifications in subsequent epics/tasks.

## Files updated
- `mobile/src/graphql/messages.ts`
- `mobile/src/screens/ChatScreen.tsx`
- `docs/mvp_tasklist.md`
