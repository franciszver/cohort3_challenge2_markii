### Assistant – Next Steps (Low-Risk, Flag-Gated)

Scope: Build on the single-tool MVP without breaking existing flows. Keep changes small, reversible, and behind flags. No sensitive information or secrets included in this document.

1) Stabilize Events Delivery (metadata-first, attachment as backup)
- Keep including `metadata.events` on assistant messages at create time.
- Retain attachment sentinel `events:{...}` as a client fallback only.
- Verify GraphQL subscription consistently returns `metadata`; if not, refetch `getMessage(id)` (already implemented) and keep short backoff.
- Acceptance: Calendar CTA appears without user retries; attachment fallback remains but metadata path works on first try.

2) Calendar Target Picker (remembered once)
- On first “Add to calendar,” list writable device calendars.
- User selects a target calendar; persist choice locally and reuse.
- Handle missing/denied permissions gracefully.
- Acceptance: Events write into the chosen calendar (e.g., Google) with success toast.

3) Preferences and Saved Lists (message-based memory, no schema changes)
- Preferences: Accept simple commands (e.g., “Set preferences: outdoor=true, budget=low”; “Show preferences”).
- Saved lists: “Save list Groceries: eggs, milk”; “Add to list Groceries: bananas”; “Show list Groceries”; “List lists”; “Delete list Groceries”.
- Persist as SYSTEM messages with `metadata.type` = "preferences" or "list"; merge newest forward.
- Plans incorporate preferences (e.g., outdoor/budget) in time slots.
- Acceptance: Set/show preferences works; lists can be created, updated, enumerated, and recalled; plans reflect preferences.

4) OpenAI-Generated Replies (flagged, strict fallback)
- Flag: `ASSISTANT_OPENAI_ENABLED` (default false).
- If enabled: call OpenAI with short timeout; prompt includes last N messages + preferences; expect compact JSON with `plan[]` and optional `events[]`.
- Validate JSON strictly; on any error/timeout → fallback to current template; keep emitting `events` for calendar CTA.
- Acceptance: With flag on, replies are richer; with flag off, current template remains.

5) Ops Hardening (post-feature)
- Secrets: load OpenAI key from secure storage in non-dev environments.
- Logging: keep structured logs; enable AppSync field logs temporarily for validation only; then disable.
- Flags: ensure all new capabilities are behind feature flags and default safe.

Rollout Order
1) Stabilize events delivery.
2) Calendar picker.
3) Preferences + saved lists.
4) OpenAI replies (flagged).
5) Ops hardening.

Notes
- No schema/VTL changes required for preferences/lists (message-based memory).
- All new UI elements remain flag-gated and degrade gracefully when disabled.

