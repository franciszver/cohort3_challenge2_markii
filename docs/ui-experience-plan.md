# UI Experience Plan

Goal: Clean up the UI/UX to match user expectations for a modern messaging app (WhatsApp-like), without losing current functionality. Each epic ends with a manual validation step.

## Master list of user-facing functionality (current)
- Auth
  - Sign up / Sign in, email verification, forgot password (screens: `mobile/src/screens/AuthScreen.tsx`, `VerifyCodeScreen.tsx`, `ForgotPassword*Screen.tsx`)
  - Auto sign-in if session exists
- Conversations
  - Combined direct + group list, latest message preview and time, unread dot (screen: `ConversationListScreen.tsx`)
  - Start new group, paste-friendly participant IDs; start direct chat via “Solo” (screens: `GroupCreateScreen.tsx`, `ConversationListScreen.tsx`)
  - Foreground notifications for new messages
- Chat
  - Send text and image URLs, optimistic PENDING → confirmed
  - Typing indicator, delivered/read receipts with info modal (screen: `ChatScreen.tsx`)
  - Timestamps and edited badge, local history caching, simple presence heartbeat
  - Basic header with username/presence dot (`components/ChatHeader.tsx`)
- Utility
  - My ID modal, copy to clipboard; sign out (from conversation list header)

## Gaps vs best practices
- Conversations
  - Missing avatars and participant names in the header for groups; no search; no swipe actions; no skeleton loading.
  - Unread count per conversation is binary; no aggregate badge.
- Chat
  - Header lacks participant list and last seen; message bubbles can be improved (alignment, colors, day dividers).
  - Input bar lacks attachment picker and disabled state while sending; no draft persistence.
- Notifications
  - No OS badge count; foreground throttling present but no global cap.
- Auth
  - Minimal error surfacing and guidance; no password rules or field validation hints.

## Epic 1: Conversations List UX
- Tasks
  1. Add avatar(s) and display names; show group member initials as composite.
  2. Add search filter for conversations by name/participant.
  3. Add skeleton shimmer while loading; graceful empty state.
  4. Add swipe actions (mark read, delete in future) with placeholders.
- Manual validation: Start app with 10+ conversations; verify avatars/names appear, search filters correctly, and swipe reveals actions without errors.

## Epic 2: Chat Screen Polish
- Tasks
  1. Improve message bubble layout (sender/receiver colors, alignment, max width, rounded corners).
  2. Add day dividers and compact timestamp beneath each bubble.
  3. Enhance input bar: persisted draft, disabled state while sending, accessory button placeholder for attachments.
  4. Header: show participant name(s), avatar(s), last seen using `formatLastSeen`.
- Manual validation: Open 1:1 and group chats; verify bubbles, timestamps, dividers, typing indicator, and header presence/last seen.

## Epic 3: Unread and Read State UX
- Tasks
  1. Ensure unread dot clears immediately on returning from chat (debounced `lastReadAt`).
  2. Show per-chat unread count (optional step) and global unread badge.
  3. Message info modal: ensure consistent ✓/✓✓ icons and colors.
- Manual validation: Enter/exit chats; verify unread updates without refresh and badges are consistent.

## Epic 4: Auth Flow UX
- Tasks
  1. Inline field validation and error messages; clear guidance for verification.
  2. Remember email between flows; smart focus handling; keyboard avoidance improvements.
  3. Add progress indicators for network actions (sign-in/up/verify/forgot).
- Manual validation: Run through sign up → verify → sign in; intentionally trigger errors and confirm helpful feedback.

## Epic 5: Notifications and Badging
- Tasks
  1. Add global notification rate limiter and unify notification style.
  2. Add OS-level app badge count equal to total unread.
- Manual validation: Receive messages across multiple conversations; ensure notifications are informative and non-spammy; app badge updates.

## Epic 6: Accessibility and Theming
- Tasks
  1. Color contrast and font scaling; ensure components respect system font size.
  2. Light/dark theme pass; consistent colors and surfaces.
- Manual validation: Toggle system font scale and dark mode; verify layout stability and readability.

Notes
- Current functionality locations noted inline per screen/component.
- Each epic is designed to be independently testable before moving to the next.
