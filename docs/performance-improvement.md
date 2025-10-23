# Performance Improvement Plan

Scope: React Native (Expo) client; focus on asynchronous paths. Each epic is chunked into manual-testable tasks without changing functionality.

## Epic A: Message List Rendering and Data Flow
- Goal: Reduce work per render, avoid duplicates, ensure smooth scrolling.
- Tasks:
  1. Virtualize and key stability
     - Verify `FlatList` props: stable `keyExtractor`, `removeClippedSubviews`, `initialNumToRender`, `windowSize`.
     - Manual test: Open chat with 200+ messages; scroll up/down without frame drops.
  2. Deduplication and sort efficiency
     - Move merge/sort into a memoized utility; avoid repeated `new Date()` parsing on each render.
     - Manual test: Receive rapid messages; ensure order correct and no duplicates.
  3. Batched state updates
     - Wrap multi-setState sequences during initial load with a single functional update.
     - Manual test: Profile CPU/Mem using Expo dev tools during initial fetch.

## Epic B: Unread State and Last-Read Consistency
- Goal: Unread dot correctness after entering/exiting chats; minimal redundant network calls.
- Tasks:
  1. Centralize `lastReadAt` writes
     - Debounce `setMyLastRead` updates on scroll and entry (e.g., 500ms trailing).
     - Manual test: Enter chat, return to list; unread dot clears reliably.
  2. Query reduction
     - Cache latest message timestamp per conversation in memory to avoid refetch for preview.
     - Manual test: Conversation list refresh doesn’t spike GraphQL traffic.

## Epic C: Subscription Reliability and Backfill
- Goal: No missed messages; graceful fallbacks.
- Tasks:
  1. Confirm subscribe-first policy
     - Ensure subscription starts before fetching (already present); add jittered retry on errors.
     - Manual test: Simulate network drop; messages continue after reconnect.
  2. OnCreate filter throttle
     - Batch notification scheduling; enforce per-conversation cooldown (already throttled) and add global cap.
     - Manual test: Burst of 20 messages triggers at most 1 notification per 1.5s per conversation.

## Epic D: Network Efficiency and Batching
- Goal: Reduce chattiness and duplicated fetches.
- Tasks:
  1. Batch user lookups
     - Replace sequential `batchGetUsers` loop with concurrency-limited batch (e.g., p=4) and memoization.
     - Manual test: Conversation list renders with avatars/names quickly even with 20 conversations.
  2. Cache introspection and schema logs
     - Disable `logQueryFieldsOnce` in production/dev builds via flag to save network.
     - Manual test: Verify no introspection calls in normal app flow.

## Epic E: Storage and Outbox
- Goal: Reliable offline with bounded retries.
- Tasks:
  1. Outbox retry backoff persistence
     - Skip jobs until `nextTryAt` time; run a timer to drain with exponential backoff.
     - Manual test: Go offline, send 3 messages, come online; messages send in order with limited CPU.
  2. Storage compaction
     - Keep only last N (e.g., 500) messages per conversation in AsyncStorage; fetch older on demand.
     - Manual test: Storage size remains bounded after long usage.

## Epic F: Presence and Typing
- Goal: Minimal overhead while staying fresh.
- Tasks:
  1. Presence heartbeat tuning
     - Backoff heartbeat when app backgrounded; resume on foreground.
     - Manual test: Background for 5 minutes; foreground resumes and online within threshold.
  2. Typing signal rate-limit
     - Keep 1200ms throttle (already implemented); coalesce while sending.
     - Manual test: Type continuously; no excessive network.

## Epic G: App Startup
- Goal: Consistent, fast configure and navigation.
- Tasks:
  1. Remove noisy logs; gate debug logs via flag.
     - Manual test: Cold start logs minimal; home screen interactive quickly.

## Epic H: Notifications
- Goal: Useful but not spammy.
- Tasks:
  1. Global notification rate limit
     - Maintain a global map of last notification times; cap total notifications per minute.
     - Manual test: 5 conversations active → notifications at a controlled rate.

## Epic I: Diagnostics and Tooling
- Goal: Ensure issues can be triaged quickly without runtime overhead.
- Tasks:
  1. Feature flags
     - Add simple runtime flags (env/extra) to enable/disable heavy logs and introspection.
     - Manual test: Toggle flags; verify behavior changes without rebuild.

Timeline and gating
- Execute epics A → B → C → D in order; each epic ends with a manual validation checklist before proceeding.
