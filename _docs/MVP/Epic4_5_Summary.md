## Epic 4 & 5 – Summary of Implemented Work (MVP)

This document summarizes what was actually implemented for Epic 4 (Message metadata) and Epic 5 (Group chat, read receipts, in‑app notifications). No sensitive or secret data is included.

### Message Metadata (Epic 4)
- Added locale‑aware timestamp rendering with a relative‑then‑absolute format.
  - Util: `mobile/src/utils/time.ts` → `formatTimestamp()`.
  - UI: `ChatScreen` shows timestamps beneath each message.
- Added edited indicator in the timeline.
  - `messages.ts` now requests `editedAt` and `ChatScreen` shows “· edited” when present.

### Read Receipts (Epic 5, 1:1 MVP)
- Minimal WhatsApp‑style checks for messages you send:
  - ✓ sent, ✓✓ gray delivered, ✓✓ blue read.
  - Implemented by decorating visible messages using `getReceiptForMessageUser()` (no heavy preloading).
- “Message info” modal on long‑press shows delivered/read times for your sent messages.
- Subscriptions for receipts are wired for future live updates; timeline decoration kept lightweight for performance.

### In‑App Notifications (Epic 5)
- Installed and used `expo-notifications` for foreground local notifications when a new message arrives and the chat is not focused.
- Suppressed notifications while the conversation is open to avoid noise.

### Group Chat Scaffolding (Epic 5)
- GraphQL helpers:
  - `mobile/src/graphql/conversations.ts`: create/list conversations; list participants; update participant `lastReadAt`.
- Screens:
  - `ConversationListScreen.tsx`: shows recent conversations with latest message preview/time and unread dot.
  - `GroupCreateScreen.tsx`: simple create flow (name + participant IDs).
  - Navigation updated in `mobile/App.tsx`; `ChatScreen` accepts `conversationId` when launched from the list.
- Unread indicator (MVP):
  - Dot (no number) computed from `ConversationParticipant.lastReadAt` vs latest message createdAt.
  - `ChatScreen` saves `lastReadAt` when the chat opens and after scroll‑end to zero the unread dot in the list.
- Basic group header visuals in list:
  - Simple composite avatar placeholder using participant initials (first two), plus latest preview/time.

### Other Stability Improvements (supporting sign‑up flow)
- Hardened `VerifyCodeScreen`:
  - Accepts email from route or manual input; disables confirm until email+code present; optional auto‑sign‑in only if password provided.

### What remains intentionally MVP‑level
- Unread shown as a dot (no numeric count) to minimize queries and complexity.
- Group receipts UI kept minimal (per‑message info on demand; timeline kept clean).
- Composite avatar uses initials; real avatars/usernames can be wired next via a small user cache.

### Files changed (high‑level)
- UI/Logic: `mobile/src/screens/ChatScreen.tsx`, `ConversationListScreen.tsx`, `GroupCreateScreen.tsx`, `HomeScreen.tsx`, `components/ChatHeader.tsx`, `App.tsx`.
- GraphQL helpers: `mobile/src/graphql/messages.ts` (editedAt, receipts helpers, latest message), `mobile/src/graphql/conversations.ts` (create/list/participants, lastReadAt), `mobile/src/graphql/users.ts` (batch user lookup).
- Utilities: `mobile/src/utils/time.ts`.
- Auth flow: `mobile/src/screens/VerifyCodeScreen.tsx`.

### Notes on data model usage
- Uses existing `Message` (with `editedAt` requested by client), `MessageRead` for receipts, and `Conversation`/`ConversationParticipant` for group chat and `lastReadAt`.
- No destructive schema changes were required for this iteration; the client requests only fields it displays.

### Validation checklist
- Timeline shows timestamps and “· edited” where applicable.
- Your sent messages show ✓/✓✓ gray/✓✓ blue as receipts arrive; long‑press reveals times.
- Receiving a message while not in the conversation triggers an in‑app notification.
- Conversation list shows latest preview/time and an unread dot; opening the chat clears the dot.
- Group creation works (basic form) and navigates to the conversation.


