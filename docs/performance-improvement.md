# Performance Improvement Plan

Scope: React Native (Expo) client; focus on asynchronous paths. Each epic is chunked into manual-testable tasks without changing functionality.

## High-Impact First (recommended order)
- FlatList virtualization and stable scroll behavior in `ChatScreen` and `ConversationListScreen`.
- Debounced, centralized `lastReadAt` writes and removal of duplicate loads.
- Concurrency-limited and memoized user lookups for avatars/names.
- Outbox timer honoring `nextTryAt` with exponential backoff (reliable offline send).
- Storage compaction to cap per-conversation history in AsyncStorage.
- Subscription retry with jittered backoff for resilience.
- Presence heartbeat pause on background; resume on foreground.
- Gate introspection and verbose logs behind runtime flags.

## Epic A: Message List Rendering and Data Flow
- Goal: Reduce work per render, avoid duplicates, ensure smooth scrolling.
- Tasks:
  1. Virtualize and key stability
     - Verify `FlatList` props: stable `keyExtractor`, `removeClippedSubviews`, `initialNumToRender` (e.g., 12–20), `windowSize` (e.g., 7), `maxToRenderPerBatch` (e.g., 12).
     - For inverted chat list, add `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}` to preserve scroll position on prepends.
     - Ensure `getItemLayout` is used if rows are fixed-height; otherwise skip.
     - Manual test: Open chat with 200+ messages; scroll up/down without frame drops.
  2. Deduplication and sort efficiency
     - Move merge/sort into a memoized utility; precompute `createdAtMs` once per message and sort by number (avoid repeated `new Date()` parsing).
     - Persist only needed fields when caching; avoid costly transforms during render.
     - Manual test: Receive rapid messages; ensure order correct and no duplicates.
  3. Batched state updates
     - Wrap multi-setState sequences during initial load with a single functional update or reducer.
     - Avoid redundant `load()` on both mount and focus (prefer one path with guarded cache refresh).
     - Manual test: Profile CPU/Mem using Expo dev tools during initial fetch.

## Epic B: Unread State and Last-Read Consistency
- Goal: Unread dot correctness after entering/exiting chats; minimal redundant network calls.
- Tasks:
  1. Centralize `lastReadAt` writes
     - Debounce `setMyLastRead` updates on scroll and entry (e.g., 500ms trailing) and coalesce duplicate requests.
     - Write `lastReadAt` on screen focus and on blur (final trailing write), not on every drag.
     - Keep last-written value in memory to avoid no-op writes.
     - Manual test: Enter chat, return to list; unread dot clears reliably.
  2. Query reduction
     - Maintain an in-memory map of latest message timestamp per conversation, updated by message subscription, to avoid per-conversation `getLatest` refetch for previews.
     - Remove duplicate initial loads (don’t call `load()` on both mount and focus without a staleness check).
     - Manual test: Conversation list refresh doesn’t spike GraphQL traffic.

## Epic C: Subscription Reliability and Backfill
- Goal: No missed messages; graceful fallbacks.
- Tasks:
  1. Confirm subscribe-first policy
     - Ensure subscription starts before fetching (already present); add exponential backoff with jitter (e.g., 500ms → 8s) when subscription errors in all modes (primary, onCreate, VTL) and automatically resubscribe.
     - Manual test: Simulate network drop; messages continue after reconnect.
  2. OnCreate filter throttle
     - Batch notification scheduling; enforce per-conversation cooldown (already throttled) and add global cap (e.g., max 10 notifications per 60s across all conversations) using a sliding window.
     - Manual test: Burst of 20 messages triggers at most 1 notification per 1.5s per conversation.

## Epic D: Network Efficiency and Batching
- Goal: Reduce chattiness and duplicated fetches.
- Tasks:
  1. Batch user lookups
     - Replace sequential `batchGetUsers` loop with concurrency-limited parallelism (e.g., p=4) and module-level memoization (Map cache with TTL) to avoid repeated lookups across screens.
     - Manual test: Conversation list renders with avatars/names quickly even with 20 conversations.
  2. Cache introspection and schema logs
     - Gate schema introspection and verbose logs behind runtime flags (e.g., `extra.ENABLE_INTROSPECTION`, `extra.DEBUG_LOGS`) and default them off for production/dev builds.
     - Manual test: Verify no introspection calls in normal app flow.

## Epic E: Storage and Outbox
- Goal: Reliable offline with bounded retries.
- Tasks:
  1. Outbox retry backoff persistence
     - Skip jobs until `nextTryAt`; run a periodic timer that drains per conversation respecting `nextTryAt` and preserves send order.
     - Ensure only one drain runs per conversation (single-flight) and stop timers on unmount/background.
     - Manual test: Go offline, send 3 messages, come online; messages send in order with limited CPU.
  2. Storage compaction
     - Keep only last N (e.g., 500) messages per conversation in AsyncStorage on each write; fetch older on demand when user scrolls up.
     - Manual test: Storage size remains bounded after long usage.

## Epic F: Presence and Typing
- Goal: Minimal overhead while staying fresh.
- Tasks:
  1. Presence heartbeat tuning
     - Use `AppState` to pause heartbeat when backgrounded (or increase interval), resume to normal cadence on foreground.
     - Manual test: Background for 5 minutes; foreground resumes and online within threshold.
  2. Typing signal rate-limit
     - Keep 1200ms throttle (already implemented); coalesce while sending.
     - Manual test: Type continuously; no excessive network.

## Epic G: App Startup
- Goal: Consistent, fast configure and navigation.
- Tasks:
  1. Remove noisy logs; gate debug logs via flag.
     - Add `extra.DEBUG_LOGS` and wrap all `console.log` in guards; default off.
     - Manual test: Cold start logs minimal; home screen interactive quickly.

## Epic H: Notifications
- Goal: Useful but not spammy.
- Tasks:
  1. Global notification rate limit
     - Maintain a global sliding window of scheduled notifications; cap total notifications per minute (e.g., 10/min). Keep per-conversation cooldown.
     - Manual test: 5 conversations active → notifications at a controlled rate.

## Epic I: Diagnostics and Tooling
- Goal: Ensure issues can be triaged quickly without runtime overhead.
- Tasks:
  1. Feature flags
     - Add simple runtime flags (env/extra) to enable/disable heavy logs and introspection and to tune rates without rebuild:
       - `DEBUG_LOGS`, `ENABLE_INTROSPECTION`, `PRESENCE_HEARTBEAT_MS`, `NOTIFY_RATE_LIMIT_PER_MINUTE`.
     - Manual test: Toggle flags; verify behavior changes without rebuild.

Timeline and gating
- Execute epics A → B → C → D in order; each epic ends with a manual validation checklist before proceeding.
