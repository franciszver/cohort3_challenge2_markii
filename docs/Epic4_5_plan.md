<!-- 3fe1155e-3bb6-4087-bf09-6e497efdea6b f50df3cc-f0b9-47d4-894e-5463dc9312f6 -->
# Epic 4 & 5 Execution Plan

> OWNER ACTIONS REQUIRED (do these first)

- Amplify schema updates (Transformer v2):
- Add `lastSeen: AWSDateTime` to `User` if missing; push.
- Add `editedAt: AWSDateTime` to `Message`.
- Ensure `Message` has index: `@index(name: "byConversation", queryField: "messagesByConversationIdAndCreatedAt", sortKeyFields: ["createdAt"])`.
- Add new models:
  - `Conversation` (id, name, isGroup, createdBy, createdAt, updatedAt)
  - `ConversationParticipant` with indexes:
  - byConversation: `@index(name: "conversationParticipantsByConversationIdAndUserId", queryField: "conversationParticipantsByConversationIdAndUserId", sortKeyFields: ["userId"])`
  - byUser: `@index(name: "conversationParticipantsByUserIdAndConversationId", queryField: "conversationParticipantsByUserIdAndConversationId", sortKeyFields: ["conversationId"])`
  - Confirm `MessageRead` has indexes:
  - `@index(name: "byMessageAndUser", queryField: "messageReadsByMessageIdAndUserId", sortKeyFields: ["userId"])`
  - `@index(name: "byUserAndReadAt", queryField: "messageReadsByUserIdAndReadAt", sortKeyFields: ["readAt"])`
- Keep existing `onMessageInConversation` subscription; ensure `createMessage` exists.
- Run: `amplify push --yes` and confirm in AppSync Schema.
- Expo permission prompt policy: confirm in-app notifications are allowed for dev builds.

---

## Scope

- Epic 4: Show timestamps and edited badge in chat with locale-aware formatting (relative for <24h, absolute otherwise). Add optional per-message “Message info” sheet for delivered/read details.
- Epic 5: Group chat using `Conversation`/`ConversationParticipant`, per-message read receipts, and in-app foreground notifications via `expo-notifications` when chat is not focused.

## Implementation Details

### Backend (Amplify GraphQL)

- Add/confirm schema changes listed above. No custom resolvers required; generated resolvers suffice.
- Optional: `onUpdateConversationParticipant` subscription for role/notification toggles.

### Client (React Native / Expo)

- Timestamp formatting util: locale-aware; relative if <24h, absolute otherwise.
- Edited badge: show when `message.editedAt` is present.
- Read receipts:
- On receive: create `MessageRead` with `deliveredAt`.
- On visible/read: update `MessageRead.readAt`.
- UI: single check = sent, double gray = delivered, double blue = read (1:1). For groups: compact "x read" on last message; message info modal lists per-user times.
- Group chat:
- New GraphQL helpers for `Conversation` and `ConversationParticipant` (create group, list user conversations, list participants, add/remove participant).
- Screens:
  - Group creation (name + select participants) → create conversation + participants.
  - Group chat screen reuses message list; header shows group name, composite avatars.
  - Conversation list screen shows latest message preview + unread count.
- Compute unread counts from `lastReadAt` vs. latest message time; cache client-side.
- Notifications:
- In-app: when new message arrives and the chat is not focused, show an Expo local notification (throttled per conversation). None while focused.
- Presence & typing: retain `lastSeen` heartbeat (30s) and 90s threshold; typing events per conversation.

### Files To Touch (indicative)

- `mobile/src/utils/time.ts` (new): formatting helpers.
- `mobile/src/components/ChatHeader.tsx`: add subtitle ("last seen …"), group header variant.
- `mobile/src/screens/ChatScreen.tsx`: render timestamp + status icons; message info modal; receipts hooks.
- `mobile/src/screens/ConversationListScreen.tsx` (new).
- `mobile/src/screens/GroupCreateScreen.tsx` (new), `GroupChatScreen.tsx` (new) or parameterize existing chat.
- `mobile/src/graphql/messages.ts`: add `editedAt` support; receipt helpers (queries/mutations/subscriptions).
- `mobile/src/graphql/conversations.ts` (new): CRUD/list for conversations/participants.

### Testing (map to your scenarios)

- Two devices: real-time delivery, receipts transition (sent→delivered→read), timestamps.
- Offline: send/receive while offline; outbox drains on reconnect; receipts reconcile.
- Backgrounded app: in-app notification appears; tapping opens chat.
- Force-quit/reopen: history persists; receipts/timestamps accurate.
- Poor network: exponential backoff for sends; no duplicates.
- Rapid-fire: 20+ bursts without dropped messages; order preserved.
- Group chat (3+): delivery/read attribution correct; unread counts accurate.

### Rollout

- Phase 1: Schema push; basic timestamps + edited badge; receipts in 1:1; in-app notifications.
- Phase 2: Group creation and chat; unread counts; message info modal.
- Phase 3: Conversation list, participant management, role flagging.

### To-dos

- [ ] Update Amplify schema (Conversation, Participant, Message.editedAt, indexes)
- [ ] Implement locale-aware timestamps and edited badge in chat UI
- [ ] Write delivered/read receipts and status icons (1:1 first)
- [ ] Add in-app local notifications for new messages when not focused
- [ ] Add GraphQL helpers for conversations and participants
- [ ] Create group creation and chat screens, header and member list
- [ ] Compute unread counts from lastReadAt vs messages
- [ ] Add message info modal for per-user delivery/read times
- [ ] Add conversation list with previews and unread badges
- [ ] Run scenario tests: offline, background, rapid-fire, 3+ participants