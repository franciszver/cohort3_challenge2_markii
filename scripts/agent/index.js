/* Minimal background agent:
 * - Verifies _docs structure (numeric subfolders, 1_FORREVIEW, 0_cache)
 * - Reads changed code (last diff) + capped full-tree summary
 * - Processes first N files in _docs/1_FORREVIEW
 * - Writes updated outputs in-place (same folder)
 * - Limits runtime and tokens for cost
 * - On any error, writes _docs/_BATCHERR.md and exits 0
 */
const fs = require("fs/promises");
const path = require("path");
const { execSync } = require("node:child_process");
const OpenAI = require("openai");
const glob = require("glob");

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, "_docs");
const FORREVIEW_DIR = path.join(DOCS_DIR, "1_FORREVIEW");
const CACHE_DIR = path.join(DOCS_DIR, "0_cache");
const ERR_FILE = path.join(DOCS_DIR, "_BATCHERR.md");

const MAX_MINUTES = parseInt(process.env.AGENT_MAX_MINUTES || "10", 10);
const MAX_FILES = parseInt(process.env.AGENT_MAX_FILES_PER_RUN || "5", 10);
const MODEL = process.env.AGENT_MODEL || "gpt-4o-mini";
const MAX_TOKENS = parseInt(process.env.AGENT_MAX_TOKENS || "2000", 10);
const SUMMARY_BYTES = parseInt(process.env.AGENT_SUMMARY_BYTES || "400000", 10);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

function watchdog() {
  const ms = MAX_MINUTES * 60 * 1000;
  setTimeout(() => {
    console.log(`[agent] Max runtime ${MAX_MINUTES}m reached; exiting.`);
    process.exit(0);
  }, ms).unref();
}

async function writeBatchErr(reason, details) {
  const ts = new Date().toISOString();
  const body = [
    "# Batch Error",
    "",
    `Time: ${ts}`,
    "",
    "The background doc agent encountered an error and has paused further runs.",
    "",
    "Reason:",
    "",
    "```",
    reason || "Unknown error",
    "```",
    "",
    details ? "Details:" : "",
    details ? "```" : "",
    details ? (typeof details === "string" ? details : JSON.stringify(details, null, 2)) : "",
    details ? "```" : "",
    "",
    "To re-enable the agent:",
    "- Fix the underlying issue (see Reason/Details above).",
    "- Delete this file: `_docs/_BATCHERR.md`",
    "- Push a new commit to the `dev` branch (or rerun the workflow manually).",
    "",
  ].join("\n");
  await fs.mkdir(DOCS_DIR, { recursive: true }).catch(() => {});
  await writeMd(ERR_FILE, body);
  console.log(`[agent] Wrote sentinel: ${path.relative(ROOT, ERR_FILE)}`);
}

async function ensureNoSentinel() {
  try {
    await fs.access(ERR_FILE);
    console.log("[agent] Sentinel _docs/_BATCHERR.md exists. Skipping.");
    process.exit(0);
  } catch {
    // no sentinel, continue
  }
}

async function ensureDocsStructure() {
  await fs.mkdir(DOCS_DIR, { recursive: true });
  // Reflect numeric subfolders present in repo (template), create if missing
  try {
    const entries = await fs.readdir(DOCS_DIR, { withFileTypes: true });
    const numeric = entries
      .filter(e => e.isDirectory() && /^[0-9]+_.+/.test(e.name))
      .map(e => e.name);
    for (const name of numeric) {
      await fs.mkdir(path.join(DOCS_DIR, name), { recursive: true });
    }
  } catch {}
  // Always-required
  await fs.mkdir(FORREVIEW_DIR, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function listChangedFiles() {
  try {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath) {
      const raw = execSync(`cat "${eventPath}"`).toString();
      const evt = JSON.parse(raw);
      const before = evt.before;
      const after = evt.after;
      if (before && after) {
        const out = execSync(`git diff --name-only ${before}..${after}`).toString();
        return out.split("\n").map(s => s.trim()).filter(Boolean);
      }
    }
  } catch {}
  try {
    const out = execSync(`git diff --name-only HEAD~1..HEAD`).toString();
    return out.split("\n").map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

async function summarizeCodebase(changedOnly = false) {
  const changed = listChangedFiles().filter(f =>
    !f.startsWith("_docs/") && !f.startsWith(".github/")
  );
  const candidates = new Set(changed);
  const addGlob = (pat) => glob.sync(pat, { cwd: ROOT, nodir: true }).forEach(f => candidates.add(f));

  if (!changedOnly) {
    addGlob("mobile/src/**/*.{ts,tsx,js,jsx}");
    addGlob("schema.graphql");
    addGlob("mobile/app.config.ts");
    addGlob("scripts/**/*.ts");
    addGlob("scripts/**/*.js");
  }

  const files = Array.from(candidates).slice(0, 500);
  let remaining = SUMMARY_BYTES;
  const parts = [];
  for (const rel of files) {
    const full = path.join(ROOT, rel);
    try {
      const stat = await fs.stat(full);
      if (stat.size <= 0) continue;
      if (stat.size > remaining) continue;
      const content = await fs.readFile(full, "utf8");
      remaining -= Buffer.byteLength(content, "utf8");
      parts.push(`FILE: ${rel}\n${content}`);
      if (remaining <= 0) break;
    } catch {}
  }
  return parts.join("\n\n---\n\n");
}

function hash(s) {
  let h = 0, i, chr;
  for (i = 0; i < s.length; i++) {
    chr = s.charCodeAt(i);
    h = ((h << 5) - h) + chr;
    h |= 0;
  }
  return `${h}`;
}

async function shouldSkip(docPath, codeSummary) {
  const key = path.basename(docPath, path.extname(docPath));
  const fp = path.join(CACHE_DIR, `${key}.md`);
  try {
    const doc = await fs.readFile(docPath, "utf8");
    const fingerprint = hash(codeSummary + "::" + doc);
    let prevFp = "";
    try { prevFp = await fs.readFile(fp, "utf8"); } catch {}
    const match = /<!--\s*agent-fingerprint:\s*([^\s]+)\s*-->/.exec(prevFp || "");
    const prev = match ? match[1] : null;
    if (prev && prev === fingerprint) return true;
    const content = `<!-- agent-fingerprint: ${fingerprint} -->\n`;
    await writeMd(fp, content);
    return false;
  } catch {
    return false;
  }
}

async function processDoc(client, codeSummary, docPath) {
  const name = path.basename(docPath);
  if (path.extname(name).toLowerCase() !== ".md") {
    console.log(`[agent] Skip (non-md): ${name}`);
    return;
  }
  const original = await fs.readFile(docPath, "utf8");

  const sys = [
    "You are a senior software engineer automating documentation updates.",
    "Goals:",
    "- Analyze the provided code summary.",
    "- Update the input document to align with the codebase and current best practices.",
    "- Keep changes scoped; preserve author voice where possible.",
    "- Include concise, actionable checklists and concrete guidance.",
  ].join("\n");

  const prompt = [
    "Repository code summary (truncated and selective):",
    "-----------------------------------------------",
    codeSummary,
    "",
    "Document to update:",
    "-------------------",
    original,
    "",
    "Update instructions:",
    "--------------------",
    "- Edit the document directly.",
    "- Fix outdated steps; add missing high-impact tasks.",
    "- Prefer practical, testable steps with acceptance checks.",
    "- Keep length similar; remove noise; add only high-value content.",
  ].join("\n");

  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: prompt }
    ],
  });

  const updated = res.choices?.[0]?.message?.content?.trim();
  if (!updated) {
    console.log(`[agent] Empty response; leaving ${name} unchanged.`);
    return;
  }
  await writeMd(docPath, updated);
  console.log(`[agent] Updated: ${path.relative(ROOT, docPath)}`);
}

async function main() {
  watchdog();
  await ensureNoSentinel();
  await ensureDocsStructure();

  let client = null;
  if (!OPENAI_API_KEY) {
    await writeBatchErr(
      "Missing OPENAI_API_KEY",
      "Set repository secret OPENAI_API_KEY to allow the agent to update documents."
    );
    return; // exit 0 so commit step can pick up the sentinel
  } else {
    client = new OpenAI({ apiKey: OPENAI_API_KEY });
  }

  let codeSummary = "";
  try {
    codeSummary = await summarizeCodebase(false);
  } catch (e) {
    await writeBatchErr(
      "Error generating code summary",
      e?.stack || e?.message || String(e)
    );
    return;
  }

  let processed = 0;
  let entries = [];
  try {
    entries = (await fs.readdir(FORREVIEW_DIR))
      .filter(f => !f.startsWith(".") && f.toLowerCase().endsWith(".md"))
      .map(f => path.join(FORREVIEW_DIR, f))
      .slice(0, MAX_FILES);
  } catch (e) {
    await writeBatchErr(
      "Error reading _docs/1_FORREVIEW",
      e?.stack || e?.message || String(e)
    );
    return;
  }

  if (!entries.length) {
    console.log("[agent] No docs in _docs/1_FORREVIEW; exit.");
    return;
  }

  for (const docPath of entries) {
    try {
      const skip = await shouldSkip(docPath, codeSummary);
      if (skip) {
        console.log(`[agent] Skip (unchanged): ${path.basename(docPath)}`);
        continue;
      }
      await processDoc(client, codeSummary, docPath);
      processed += 1;
    } catch (e) {
      await writeBatchErr(
        `Error processing ${path.basename(docPath)}`,
        e?.stack || e?.message || String(e)
      );
      return;
    }
  }

  console.log(`[agent] Done. Processed ${processed} file(s).`);
}

main().catch(async (e) => {
  console.error("[agent] Fatal:", e);
  try {
    await writeBatchErr("Fatal error in agent", e?.stack || e?.message || String(e));
  } catch {}
  process.exit(0); // allow commit step to run
});

// Enforce markdown-only file writes within _docs/*
function assertMdWrite(targetPath) {
  const ext = path.extname(targetPath).toLowerCase();
  const rel = path.relative(ROOT, targetPath).replace(/\\/g, "/");
  if (!rel.startsWith("_docs/")) {
    throw new Error(`Refusing to write outside _docs/: ${rel}`);
  }
  if (ext !== ".md") {
    throw new Error(`Refusing to write non-markdown file: ${rel}`);
  }
}

async function writeMd(targetPath, content) {
  assertMdWrite(targetPath);
  await fs.writeFile(targetPath, content, "utf8");
}


