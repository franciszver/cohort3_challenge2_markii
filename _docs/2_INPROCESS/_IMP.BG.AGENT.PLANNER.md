<!-- 2482dd36-ef58-4575-a54e-bd1623ae6d9d 8d512487-e247-44b3-bde9-73a2228db363 -->
# BackgroundAgentSetup.md

## Goal

Automate documentation updates on dev pushes: analyze code changes, update docs in `_docs/1_FORREVIEW`, and halt on errors via `_docs/_BATCHERR.md` until resolved.

## Steps

### 1) Verify and create _docs structure (agent)

- Ensure `_docs/` exists; create if missing.
- Detect numeric subfolders (names matching `^[0-9]+_.*# BackgroundAgentSetup.md

## Goal

Automate documentation updates on dev pushes: analyze code changes, update docs in `_docs/1_FORREVIEW`, and halt on errors via `_docs/_BATCHERR.md` until resolved.

## Steps

) from the current `_docs/` directory (template = what’s in the repo at runtime).

- Ensure the following always exist (create if missing):
- `_docs/1_FORREVIEW/` (input and output)
- `_docs/0_cache/` (fingerprints)
- Optionally ensure any other numeric subfolders present in the template exist (create if missing).

### 2) Add workflow (agent)

- Create `.github/workflows/doc-agent.yml` with:
- Triggers on push to `dev` with `paths` limited to code files
- Concurrency group `doc-agent-dev`
- `timeout-minutes: 12`
- Early-exit step if `_docs/_BATCHERR.md` exists
- Steps: checkout, verify `_docs/1_FORREVIEW`, Node setup, deps install, run `scripts/agent/index.js`, commit changes
- Commit `file_pattern`: `_docs/1_FORREVIEW/** _docs/_cache/** _docs/_BATCHERR.md`

### 3) Add agent script (agent)

- Create `scripts/agent/index.js` that:
- Enforces watchdog limit via `AGENT_MAX_MINUTES`
- Summarizes changed code + capped repo context (`AGENT_SUMMARY_BYTES`)
- Processes up to `AGENT_MAX_FILES_PER_RUN` docs from `_docs/1_FORREVIEW`
- Skips re-processing via `_docs/_cache` fingerprint
- Writes updates in-place (same folder)
- On any error, writes `_docs/_BATCHERR.md` (with next steps) and exits 0
- On startup, exits if `_docs/_BATCHERR.md` exists

### 4) Configure repo secret (human)

- Add Actions secret `OPENAI_API_KEY` in Repo Settings → Secrets and variables → Actions

### 5) Set Actions permissions (human)

- Repo Settings → Actions → General → Workflow permissions → enable “Read and write permissions”

### 6) Tune cost limits (agent)

- In the workflow `env`:
- `AGENT_MAX_MINUTES` (e.g., 10)
- `AGENT_MAX_FILES_PER_RUN` (e.g., 5)
- `AGENT_MODEL` (e.g., `gpt-4o-mini`)
- `AGENT_MAX_TOKENS` (e.g., 2000)
- `AGENT_SUMMARY_BYTES` (e.g., 400000)

### 7) Validate (human)

- Put 1–2 docs into `_docs/1_FORREVIEW/`
- Make a trivial code change in `dev`
- Confirm a new commit updates those docs in place; check that `_docs/_cache` contains fingerprints

### 8) Error behavior (auto)

- On any error, `_docs/_BATCHERR.md` is created with:
- Timestamp, reason, and details
- Instructions to delete `_docs/_BATCHERR.md` after fixing root cause
- Subsequent runs are blocked until the file is deleted

### 9) Operate

- Normal: push code to `dev` → workflow runs → docs updated in `_docs/1_FORREVIEW/`
- Blocked: if `_BATCHERR.md` exists, delete it and push again after fixing

## Files to add

- `.github/workflows/doc-agent.yml`
- `scripts/agent/index.js`
- Folders: `_docs/1_FORREVIEW/`, `_docs/_cache/`

## Notes

- Adjust workflow `paths` if your code lives outside the listed globs
- You can also run the workflow manually via `workflow_dispatch`

### To-dos

- [ ] Create _docs/1_FORREVIEW and _docs/_cache directories
- [ ] Add .github/workflows/doc-agent.yml with triggers, blocking, commit patterns
- [ ] Add scripts/agent/index.js implementing summary, updates, sentinel, watchdog
- [ ] Add OPENAI_API_KEY as Actions secret
- [ ] Enable Actions read/write workflow permissions
- [ ] Tune AGENT_* env vars for cost/time caps
- [ ] Place sample docs and trigger run on dev; verify outputs