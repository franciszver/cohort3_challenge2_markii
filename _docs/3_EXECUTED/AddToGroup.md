<!-- 75bee5ab-2fe7-41e8-9d12-5698271ff9cc 4ffa195c-6837-4858-ab41-1a2835c3a40a -->
# Add to Group — Header Plus Button Add Flow

## Goal

Allow adding a new participant from a top-right “+” button near the delete action in chat, opening a centered input modal to enter a UID, then adding the user to the current conversation.

## Summary

- Replace the participants list UI with a single add entry point in the header.
- Frontend-only: reuse existing `createConversationParticipant` via `ensureParticipant`.
- Optimistic UI; UID-only input (no email lookup).
- AI chat compatible: supports `assistant::<userId>` conversations without adding the assistant as a participant.

## Affected Files

- `mobile/src/screens/ChatScreen.tsx` (state + modal + handler + header action)
- `mobile/src/components/ChatHeader.tsx` (if header actions are centralized; otherwise do it in `ChatScreen`)
- `mobile/src/graphql/conversations.ts` (reuse `ensureParticipant`)

## Steps

1) Feature Flag

- Wrap new UI/behavior in `ENABLE_ADD_TO_GROUP` from `getFlags()`; default off.

2) Header Action

- Add a top-right “+” button next to the existing delete action in the chat header.
- On press: open `AddParticipant` modal.

3) Modal

- Centered modal with:
- `TextInput` placeholder: “Enter User ID”
- Buttons: Add, Cancel
- Optional error text; loading state while adding

4) State & Handlers (in `ChatScreen`)

- State: `addVisible`, `addInput`, `addBusy`, `addError`, and ensure `conversationId` is captured during init.
- `onConfirmAdd()`:
- Validate `conversationId` and input; guard system ids (`assistant-bot`, `assistant-*`).
- Treat input as UID; call `ensureParticipant(conversationId, userId, 'MEMBER')`.
- Optimistically toast success; close modal and clear input.
- Handle backend errors with toast and keep modal open.

5) Remove Participants List Entry Points

- Remove the old participants list modal trigger and state from `ChatScreen` while keeping any unrelated logic intact.

## AI Chat Compatibility

- Detect assistant chats via `conversationId.startsWith('assistant::')`.
- Allow adding human participants; do not add `assistant-bot`.
- New participant should receive notifications (existing notify Lambda scans participants table).

## Backward Compatibility & Safety

- Feature-flagged (`ENABLE_ADD_TO_GROUP`); default off acts as a kill switch.
- No schema/infra changes; reuse existing APIs.
- Try/catch around network calls; toast on error; chat flow unaffected.
- Do not modify message logic, receipts, presence, typing.
- Avoid duplicates by guard on add; backend is effectively idempotent.

## Acceptance Criteria

- Plus button visible when flag on; opens modal; adding valid UID succeeds.
- New participant can send/receive; appears in conversation members server-side.
- Errors are surfaced without breaking chat.
- In assistant chats, adding human works; assistant remains non-participant.
- With flag off, app behaves exactly as before (no plus button, no removed behavior unless also flag-gated).

## Edge Cases

- Invalid/nonexistent UID: backend returns error; show toast.
- Duplicate: avoid duplicate local UI; backend handles gracefully.
- Missing `conversationId`: no-op with error toast.
- System ids blocked (`assistant-bot`, `assistant-*`).

## Non-Regression Tests

- Direct chat: messaging, typing, read receipts unchanged.
- Group chat: list, unread badges, notifications unchanged.
- Offline: sending/queueing unchanged; add flow shows error/no-op as appropriate.
- Assistant chat: with flag on, add works; with flag off, behavior unchanged.

## Estimate

- Base feature: 1–2 hours.

## To-dos

- [ ] Add feature flag `ENABLE_ADD_TO_GROUP`
- [ ] Add header “+” action next to delete
- [ ] Implement centered AddParticipant modal (UID-only)
- [ ] Implement onConfirmAdd (UID-only) with guards and error handling
- [ ] Remove old participants list trigger/state (behind flag to avoid regressions)
- [ ] Manual tests incl. assistant chat and non-regression

### To-dos

- [ ] Add conversationId and addParticipantInput state to ChatScreen
- [ ] Set conversationId when cid is computed in init effect
- [ ] Implement resolveUserIdFromInput and onAddParticipant
- [ ] Add TextInput and + button to participants modal
- [ ] Enable email-based lookup via lookupUserIdByEmail
- [ ] Gate add controls to admins only (if required)
- [ ] Run manual tests: happy path, duplicate, errors, persistence