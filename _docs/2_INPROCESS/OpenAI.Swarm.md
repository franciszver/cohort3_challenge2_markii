<!-- fc418107-a09b-446b-bfa8-374cf4451892 31313af2-bc3b-46e6-95a4-a80fc84500ab -->
# OpenAI-Enhanced Assistant (Two-Phase, Flag-Gated)

## Phase 1 — Better Replies (no external retrieval)

- Improve reply quality using OpenAI while keeping the current memory + calendar.
- Strict 6s timeout and JSON-validate; fallback to existing template on any issue.
- Flag: `ASSISTANT_OPENAI_ENABLED` (default false). Optional: `OPENAI_MODEL`.
- Key loading: `getOpenAIKey()` → Secrets Manager if `OPENAI_SECRET_ARN` set; else env var.
- Files: `scripts/agent/assistant.js` only.
- Output: post TEXT; include `metadata.events` and `attachments: ['events:{...}']` if provided.

## Phase 2 — Context-Driven Recipe Suggestions (lightweight retrieval)

- Detect "what’s for dinner" intent and use current chat context (preferences) to drive a small recipe search.
- Retriever (choose one, all behind a flag `ASSISTANT_RECIPE_ENABLED`):
- Public recipe API with strict timeout, or
- Small curated DynamoDB table (title, ingredients, tags), or
- Bedrock Knowledge Base (if available in account).
- Return 1–3 concise suggestions (title, ingredients list, short steps); fallback to Phase 1 reply on error/timeout.
- Output mirrors events pattern: `metadata.recipes` and `attachments: ['recipes:{...}']`.

## Current State Snapshot (from codebase)

- Assistant Lambda (`scripts/agent/assistant.js`) posts a canned weekend plan; no OpenAI calls yet.
- Events are included as `metadata.events` and an attachment sentinel `events:{...}` (stringified JSON).
- Mobile renders a calendar CTA when it finds `metadata.events` or `events:{...}` and is gated by `ASSISTANT_CALENDAR_ENABLED`.
- Mobile flags present: `ASSISTANT_ENABLED`, `ASSISTANT_ENDPOINT`, `ASSISTANT_CALENDAR_ENABLED`.
- Lambda envs present: `APPSYNC_ENDPOINT`, `AWS_REGION`, `ASSISTANT_BOT_USER_ID`, `ASSISTANT_REPLY_PREFIX`.
- Message context: assistant fetches last 10 recent messages.
- AppSync requests use a 4s HTTP timeout; no OpenAI timeout exists yet.
- No recipes retriever or UI exists today.

## Implementation Notes

- Add env flags and minimal helpers; keep all code paths gated and reversible.
- Keep prompt compact: last N user/assistant turns + parsed preferences only.
- Validate model output: `{ text: string, events?: [{ title, startISO, endISO, notes? }] }`.
- Timeouts: 6s for Phase 1; 3–5s for Phase 2 retrieval.
- Logging: guard under `DEBUG_LOGS`; never log secrets or full prompts.

## Acceptance Criteria

- Flag OFF: identical behavior to today.
- Flag ON (Phase 1): richer replies within ≤8s; calendar CTA still works.
- Flag ON (Phase 2): "what’s for dinner" yields 1–3 suggestions respecting preferences; if retrieval fails, user gets a Phase‑1 reply.

## Decisions Needed

- OpenAI provider and default model (proposed: OpenAI, `gpt-4o-mini`, ~300 max output tokens).
- Keep last N=10 turns for prompting (matches current fetch), or adjust?
- Phase 2 retriever choice for MVP (public API vs small DynamoDB vs Bedrock KB).
- Recipes attachment shape: `recipes:{"recipes":[{title,ingredients[],steps[]}]} ` to mirror events.
- Timezone handling: keep ISO UTC in metadata; convert on-device when adding to calendar.

## Manual Steps (human-in-the-loop)

- Example env files (repo hygiene):
  - Update `env.example.json` (Lambda) and `mobile/.env.example` (Expo) to include placeholders for new flags.
  - Ensure no secrets are committed; use safe placeholders for IDs/ARNs.
- Secrets for OpenAI:
  - Create an AWS Secrets Manager secret containing the OpenAI API key (string or JSON) and note the ARN.
  - Grant the Lambda execution role permission `secretsmanager:GetSecretValue` for that secret ARN.
  - Decide whether to pass via `OPENAI_SECRET_ARN` (preferred) or set `OPENAI_API_KEY` directly (dev only).
- Lambda configuration and deploy:
  - Set new env vars on the Lambda: `ASSISTANT_OPENAI_ENABLED`, `ASSISTANT_RECIPE_ENABLED`, `OPENAI_MODEL`, and either `OPENAI_SECRET_ARN` or `OPENAI_API_KEY`.
  - Run `scripts/agent/deploy.ps1` (or update via Console) to apply env changes and redeploy.
- Mobile app configuration:
  - In `mobile/.env`, set `ASSISTANT_ENABLED=true`, `ASSISTANT_ENDPOINT=<your API Gateway base>`, and (optionally) `ASSISTANT_CALENDAR_ENABLED=true`.
  - Rebuild/restart the app so flags propagate (Expo reload).
- Phase 2 retriever setup (choose one):
  - Public API: obtain API key/credentials, set new Lambda env(s), verify any allowlists.
  - DynamoDB: create a small `recipes` table (title, ingredients[], tags), seed initial items, grant Lambda read.
  - Bedrock KB: create KB/datasource, attach IAM permissions, record identifiers/envs.
- Rollout:
  - Enable flags in staging first, validate latency (≤8s E2E), then enable in production.
  - Confirm calendar permission prompt on device and verify “Add to calendar” flow.
- CI/CD and repo secrets:
  - Ensure repository/workflow secrets include `OPENAI_API_KEY` if any automation depends on it (background docs agent already uses this).

## Config (example)

- Shell: set profile/region first, then update Lambda env vars (no secrets in code/logs).

## To‑Dos

- [ ] Add Lambda flags/env: `ASSISTANT_OPENAI_ENABLED`, `ASSISTANT_RECIPE_ENABLED`, `OPENAI_MODEL`, and key via `OPENAI_SECRET_ARN` or `OPENAI_API_KEY`.
- [ ] Update deploy script to include new envs in Lambda configuration.
- [ ] Update example env templates (`env.example.json`, `mobile/.env.example`) with placeholders for new flags (no secrets).
- [ ] Build prompt from last 10 messages + parsed preferences (reuse existing preference parsing).
- [ ] Implement OpenAI call with 6s timeout and strict JSON validation: `{ text, events?[] }`.
- [ ] On success: post text, include `metadata.events` and `events:{...}` attachment if events present; on failure/timeout: fallback to current template.
- [ ] Implement intent detection for dinner queries (light regex to start) gated by `ASSISTANT_RECIPE_ENABLED`.
- [ ] Implement first recipes retriever with 3–5s timeout; on success: return 1–3 items and include `metadata.recipes` and `recipes:{...}` attachment; on failure: fall back to Phase‑1.