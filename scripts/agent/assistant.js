// Minimal Assistant Lambda handler (single-tool MVP)
// - POST /agent/weekend-plan
// - Tool: getRecentMessages via AppSync (IAM-signed)
// - Reply: echo last user message; post via createMessage as assistant-bot

const crypto = require('crypto');
const https = require('https');

const { APPSYNC_ENDPOINT, AWS_REGION = 'us-east-1', ASSISTANT_BOT_USER_ID = 'assistant-bot', ASSISTANT_REPLY_PREFIX = 'Assistant Echo:' } = process.env;
const CODE_VERSION = 'decisions-debug-v3';

if (!APPSYNC_ENDPOINT) {
  console.warn('[assistant] Missing APPSYNC_ENDPOINT');
}

// Basic SigV4 signer for AppSync GraphQL
function signAndRequest({ query, variables, opName, jwt }) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(APPSYNC_ENDPOINT);
      const service = 'appsync';
      const host = url.host;
      const path = url.pathname || '/graphql';
      const method = 'POST';
      const body = JSON.stringify({ query, variables });
      const headers = { 'Content-Type': 'application/json', 'Host': host };
      if (jwt) {
        headers['Authorization'] = jwt;
      } else {
        // SigV4 signing path
        const now = new Date();
        const amzdate = now.toISOString().replace(/[:-]|\..*/g, '').slice(0, 15) + 'Z';
        const datestamp = amzdate.slice(0, 8);
        const accessKey = process.env.AWS_ACCESS_KEY_ID;
        const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
        const sessionToken = process.env.AWS_SESSION_TOKEN;
        if (!accessKey || !secretKey) {
          console.warn('[assistant] Missing AWS credentials for SigV4 signing and no JWT provided');
          return reject(new Error('No auth available for AppSync'));
        }
        const canonicalUri = path;
        const canonicalQuerystring = '';
        const canonicalHeaders = `host:${host}\n` + `x-amz-date:${amzdate}\n` + (sessionToken ? `x-amz-security-token:${sessionToken}\n` : '');
        const signedHeaders = sessionToken ? 'host;x-amz-date;x-amz-security-token' : 'host;x-amz-date';
        const payloadHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
        const canonicalRequest = [method, canonicalUri, canonicalQuerystring, canonicalHeaders, signedHeaders, payloadHash].join('\n');
        const algorithm = 'AWS4-HMAC-SHA256';
        const credentialScope = `${datestamp}/${AWS_REGION}/${service}/aws4_request`;
        const stringToSign = [algorithm, amzdate, credentialScope, crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')].join('\n');
        function hmac(key, data) { return crypto.createHmac('sha256', key).update(data, 'utf8').digest(); }
        const kDate = hmac(`AWS4${secretKey}`, datestamp);
        const kRegion = hmac(kDate, AWS_REGION);
        const kService = hmac(kRegion, service);
        const kSigning = hmac(kService, 'aws4_request');
        const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
        const authorizationHeader = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
        headers['X-Amz-Date'] = amzdate;
        headers['Authorization'] = authorizationHeader;
        if (sessionToken) headers['X-Amz-Security-Token'] = sessionToken;
      }

      const options = { hostname: host, path: path, method, headers, timeout: 4000, port: url.port || 443 }; 
      const startedAt = Date.now();
      console.log(`[assistant] AppSync request ${opName || '(unknown)'} → ${host}${path}`);
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (d) => { try { data += d; } catch {} });
        res.on('end', () => {
          try {
            console.log(`[assistant] AppSync response ${opName || '(unknown)'} ${res.statusCode} in ${Date.now()-startedAt}ms`);
            try {
              const json = JSON.parse(data || '{}');
              resolve(json);
            } catch (e) {
              resolve({ errors: [{ message: 'Non-JSON response from AppSync' }], raw: data });
            }
          } catch (e2) {
            try { console.warn('[assistant] AppSync end handler error:', e2?.message || e2); } catch {}
            resolve({ errors: [{ message: 'End handler error' }], raw: data });
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { try { req.destroy(new Error('Request timeout')); } catch {} });
      req.write(body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function getRecentMessages(conversationId, limit = 10, jwt) {
  const q = /* GraphQL */ `
    query MessagesByConversation($conversationId: String!, $limit: Int, $sortDirection: ModelSortDirection) {
      messagesByConversationIdAndCreatedAt(conversationId: $conversationId, limit: $limit, sortDirection: $sortDirection) {
        items { id conversationId content senderId messageType attachments metadata createdAt updatedAt }
      }
    }
  `;
  const res = await signAndRequest({ query: q, variables: { conversationId, limit, sortDirection: 'DESC' }, opName: 'messagesByConversationIdAndCreatedAt', jwt });
  if (res?.errors?.length) {
    console.warn('[assistant] getRecentMessages errors:', JSON.stringify(res.errors));
    throw new Error(res.errors[0].message || 'AppSync error');
  }
  return res?.data?.messagesByConversationIdAndCreatedAt?.items || [];
}

async function ensureAssistantParticipant(conversationId, jwt) {
  try {
    // Check if assistant-bot is already a participant
    const q = /* GraphQL */ `
      query CheckParticipant($conversationId: String!, $userId: String!) {
        conversationParticipantsByConversationIdAndUserId(conversationId: $conversationId, userId: { eq: $userId }, limit: 1) {
          items { id }
        }
      }
    `;
    const check = await signAndRequest({ query: q, variables: { conversationId, userId: ASSISTANT_BOT_USER_ID }, opName: 'checkParticipant', jwt });
    if (check?.data?.conversationParticipantsByConversationIdAndUserId?.items?.length) {
      return; // Already a participant
    }
    
    // Add assistant-bot as a participant
    const m = /* GraphQL */ `
      mutation CreateParticipant($input: CreateConversationParticipantInput!) {
        createConversationParticipant(input: $input) { id }
      }
    `;
    const nowIso = new Date().toISOString();
    const input = {
      conversationId,
      userId: ASSISTANT_BOT_USER_ID,
      joinedAt: nowIso,
      role: 'MEMBER'
    };
    await signAndRequest({ query: m, variables: { input }, opName: 'createConversationParticipant', jwt });
    console.log('[assistant] Added assistant-bot as conversation participant');
  } catch (e) {
    console.warn('[assistant] Failed to ensure participant (non-fatal):', e?.message || e);
  }
}

async function createAssistantMessage(conversationId, content, jwt, metadataObj, attachmentsArr, type = 'TEXT') {
  // Ensure assistant-bot is a participant first
  await ensureAssistantParticipant(conversationId, jwt);
  
  const m = /* GraphQL */ `
    mutation CreateMessage($input: CreateMessageInput!) {
      createMessage(input: $input) { id conversationId content senderId messageType attachments metadata createdAt updatedAt }
    }
  `;
  const nowIso = new Date().toISOString();
  const input = { conversationId, content, senderId: ASSISTANT_BOT_USER_ID, messageType: type, createdAt: nowIso, updatedAt: nowIso };
  if (metadataObj) {
    try { input.metadata = JSON.stringify(metadataObj); } catch {}
  }
  if (attachmentsArr && Array.isArray(attachmentsArr) && attachmentsArr.length) {
    input.attachments = attachmentsArr;
  }
  const res = await signAndRequest({ query: m, variables: { input }, opName: 'createMessage', jwt });
  if (res?.errors?.length) {
    console.warn('[assistant] createAssistantMessage errors:', JSON.stringify(res.errors));
    throw new Error(res.errors[0].message || 'AppSync error');
  }
  return res?.data?.createMessage;
}

async function ensureMessageFields(id, jwt) {
  const u = /* GraphQL */ `
    mutation UpdateMessage($input: UpdateMessageInput!) {
      updateMessage(input: $input) { id messageType updatedAt }
    }
  `;
  const nowIso = new Date().toISOString();
  const input = { id, messageType: 'TEXT', updatedAt: nowIso };
  const res = await signAndRequest({ query: u, variables: { input }, opName: 'updateMessage', jwt });
  if (res?.errors?.length) {
    console.warn('[assistant] updateMessage errors:', JSON.stringify(res.errors));
    return null;
  }
  return res?.data?.updateMessage;
}

// Best-effort in-memory idempotency for warm containers
const seen = new Set();

function parseKeyValueCsv(s) {
  const out = {};
  const parts = String(s || '').split(',');
  for (const p of parts) {
    const [k, v] = p.split('=').map(x => (x || '').trim());
    if (k) out[k] = v || true;
  }
  return out;
}

function normalizeTitle(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 60);
}

function packListPayload(id, title, items) {
  try { return JSON.stringify({ type: 'list', id, title, items }); } catch { return '{}' }
}

// Coerce AWSJSON (which may be returned as a string or object) into an object
function toObjectJson(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return {}; }
  }
  try { return JSON.parse(String(v)); } catch { return {}; }
}

function dbg(...args) {
  try {
    const v = String(process.env.DEBUG_LOGS || '').toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes') {
      console.log('[assistant][debug]', ...args);
    }
  } catch {}
}

// Heuristic decision extractor (lightweight, no extra API calls)
function extractDecisionsFromRecent(recent, currentUserId) {
  try {
    const items = Array.isArray(recent) ? recent.slice() : [];
    if (!items.length) return [];
    const hits = [];
    const patterns = [
      /\bwe\s+decided\b/i,
      /\bdecided\s+to\b/i,
      /\blet'?s\s+go\s+with\b/i,
      /\bwe(?:'|\s+|\s*have\s*)agreed\b/i,
      /\bsettled\s+on\b/i,
      /\bwe\s+(?:will|\'ll)\s+go\s+with\b/i,
      /\bwe\s+choose\b/i,
      /\bwe\s+chose\b/i,
    ];
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      const text = String(m?.content || '').trim();
      if (!text) continue;
      if (!patterns.some((re) => re.test(text))) continue;
      const decidedAtISO = (() => { try { return new Date(m.createdAt).toISOString(); } catch { return new Date().toISOString(); } })();
      let title = text.slice(0, 60);
      try {
        const t2 = text.replace(/^[^:]+:\s*/, '');
        if (t2) title = t2.slice(0, 60);
      } catch {}
      const summary = text.slice(0, 200);
      const participantsSet = new Set();
      const start = Math.max(0, i - 5);
      const end = Math.min(items.length - 1, i + 5);
      for (let j = start; j <= end; j++) {
        const sid = items[j]?.senderId;
        if (sid && sid !== 'assistant-bot') participantsSet.add(sid);
      }
      let participants = Array.from(participantsSet);
      if (!participants.length && currentUserId) participants = [currentUserId];
      hits.push({ title, summary, participants, decidedAtISO });
      if (hits.length >= 3) break;
    }
    return hits;
  } catch { return []; }
}

function detectPriority(text) {
  try {
    const t = String(text || '').trim();
    if (!t) return 'normal';
    
    // Keyword-based urgency detection
    const urgentKeywords = /\b(urgent|asap|critical|emergency|important|high priority|time sensitive|immediately|now|quick|rush)\b/i;
    const hasKeyword = urgentKeywords.test(t);
    
    if (hasKeyword) {
      return 'high';
    }
    
    // Future: AI semantic detection would go here when called via OpenAI
    // The model can override this by returning priority in its JSON response
    
    return 'normal';
  } catch {
    return 'normal';
  }
}

function logMetric(name, value = 1, dims) {
  try {
    const base = { metric: name, value };
    const line = dims && typeof dims === 'object' ? { ...base, ...dims } : base;
    console.log('[metric]', JSON.stringify(line));
  } catch {}
}

function toIsoOrNull(s) {
  try {
    const d = new Date(s);
    const t = d.getTime();
    if (!Number.isFinite(t)) return null;
    return d.toISOString();
  } catch { return null; }
}

// Simple deterministic event parsing as a safety net when the model returns no events
function parseDayOffsetFromWord(word, now) {
  try {
    const t = String(word || '').trim().toLowerCase();
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    if (t === 'today') return 0;
    if (t === 'tomorrow') return 1;
    const short = ['sun','mon','tue','wed','thu','fri','sat'];
    const idxLong = days.indexOf(t);
    const idxShort = short.indexOf(t.slice(0,3));
    const targetIdx = idxLong >= 0 ? idxLong : idxShort;
    if (targetIdx < 0) return null;
    const currentIdx = now.getDay();
    let delta = targetIdx - currentIdx;
    if (delta <= 0) delta += 7;
    return delta;
  } catch { return null; }
}

function parseTimeToken(s) {
  const str = String(s || '').trim().toLowerCase();
  const m12 = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(str);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2] ? parseInt(m12[2], 10) : 0;
    const ap = m12[3].toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, minute: min };
  }
  const m24 = /^(\d{1,2}):(\d{2})$/.exec(str);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, minute: min };
  }
  const mHourAm = /^(\d{1,2})\s*(am|pm)$/.exec(str);
  if (mHourAm) {
    let h = parseInt(mHourAm[1], 10);
    const ap = mHourAm[2].toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { hour: h, minute: 0 };
  }
  return null;
}

function buildDateOn(baseDate, hour, minute) {
  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0, 0);
}

function parseEventsFromText(text, now = new Date()) {
  try {
    const t = String(text || '').trim();
    if (!t) return [];
    // Build text variants to be robust to punctuation and prefixes
    const dayRe = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|today|tomorrow)/i;
    const v1 = t;
    const v2 = t.replace(/\bplan\s+([a-z]+)\s*:\s*/i, (_m, d) => `plan ${d} `);
    const v3 = t.replace(dayRe, (d) => d).replace(/:\s*(?=\d)/g, ' ');
    const v4 = t.replace(/^\s*plan\s+/i, '');
    const variants = Array.from(new Set([v1, v2, v3, v4].map(s => (s || '').trim()).filter(Boolean)));

    for (const scan of variants) {
      let dayOffset = 0;
      const dm = dayRe.exec(scan);
      if (dm) {
        const off = parseDayOffsetFromWord(dm[1], now);
        if (off != null) dayOffset = off;
      }
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 0, 0, 0, 0);
      const parts = scan.split(/;+/).map(s => s.trim()).filter(Boolean);
      const out = [];
      for (const partRaw of (parts.length ? parts : [scan])) {
      const part = partRaw.trim();
      const lower = part.toLowerCase();
      let start = null; let end = null; let title = null;
      // Range like 6-7am or 6:00-7:00 (optional am/pm suffix applied to both)
      const mRange = /(\d{1,2}(?::\d{2})?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?/i.exec(lower);
      if (mRange) {
        const ap = mRange[3] ? mRange[3] : '';
        const aTok = parseTimeToken(mRange[1] + ap) || parseTimeToken(mRange[1]);
        const bTok = parseTimeToken(mRange[2] + ap) || parseTimeToken(mRange[2]);
        if (aTok && bTok) {
          start = buildDateOn(base, aTok.hour, aTok.minute);
          end = buildDateOn(base, bTok.hour, bTok.minute);
        }
        const after = part.slice(mRange.index + mRange[0].length).trim().replace(/^[:\-–]\s*/, '');
        title = after || 'Planned item';
      }
      if (!start) {
        const mSingle = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(lower);
        if (mSingle) {
          const tok = parseTimeToken(mSingle[1]);
          if (tok) {
            start = buildDateOn(base, tok.hour, tok.minute);
            end = new Date(start.getTime() + 60*60*1000);
            const after = part.slice(mSingle.index + mSingle[0].length).trim().replace(/^[:\-–]\s*/, '');
            title = after || 'Planned item';
          }
        }
      }
      if (!start) {
        // Handle explicit am/pm on both sides: e.g., 7:00am-8:00am title
        const mBoth = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(part);
        if (mBoth) {
          const h1 = parseInt(mBoth[1], 10);
          const mi1 = mBoth[2] ? parseInt(mBoth[2], 10) : 0;
          const ap1 = mBoth[3].toLowerCase();
          const h2 = parseInt(mBoth[4], 10);
          const mi2 = mBoth[5] ? parseInt(mBoth[5], 10) : 0;
          const ap2 = mBoth[6].toLowerCase();
          const t1 = parseTimeToken(`${h1}:${String(mi1).padStart(2,'0')}${ap1}`) || parseTimeToken(`${h1}${ap1}`);
          const t2 = parseTimeToken(`${h2}:${String(mi2).padStart(2,'0')}${ap2}`) || parseTimeToken(`${h2}${ap2}`);
          if (t1 && t2) {
            start = buildDateOn(base, t1.hour, t1.minute);
            end = buildDateOn(base, t2.hour, t2.minute);
            const idx = mBoth.index + mBoth[0].length;
            const after = part.slice(idx).trim().replace(/^[:\-–]\s*/, '');
            title = after || 'Planned item';
          }
        }
      }
      if (start && end) {
        out.push({ title: String(title || 'Planned item').slice(0,80), startISO: start.toISOString(), endISO: end.toISOString() });
      }
      if (out.length >= 10) break;
    }
      if (out.length) return out;
    }
    // Final fallback: slice from first time token and parse a simple range
    try {
      const mFirst = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(t);
      if (mFirst) {
        const tail = t.slice(mFirst.index);
        const mPair = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(tail);
        let sDate = null; let eDate = null;
        if (mPair) {
          const aTok = parseTimeToken(mPair[1]);
          const bTok = parseTimeToken(mPair[2]);
          if (aTok && bTok) {
            const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            sDate = buildDateOn(base, aTok.hour, aTok.minute);
            eDate = buildDateOn(base, bTok.hour, bTok.minute);
          }
        } else {
          const aTok = parseTimeToken(mFirst[0]);
          if (aTok) {
            const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            sDate = buildDateOn(base, aTok.hour, aTok.minute);
            eDate = new Date(sDate.getTime() + 60*60*1000);
          }
        }
        if (sDate && eDate) {
          const title = t.slice(mFirst.index + (mPair ? mPair[0].length : mFirst[0].length)).trim() || 'Planned item';
          return [{ title: String(title).slice(0,80), startISO: sDate.toISOString(), endISO: eDate.toISOString() }];
        }
      }
    } catch {}
    return [];
  } catch { return []; }
}

function validateModelResponse(raw) {
  try {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    const text = String(raw.text || '').trim();
    if (!text) return null;
    out.text = text.slice(0, 800);
    const evIn = Array.isArray(raw.events) ? raw.events : [];
    const evOut = [];
    for (const e of evIn) {
      if (!e) continue;
      const title = String(e.title || '').trim();
      const startIso = toIsoOrNull(e.startISO || e.startIso || e.start);
      const endIso = toIsoOrNull(e.endISO || e.endIso || e.end);
      const notes = e.notes != null ? String(e.notes).slice(0, 200) : undefined;
      if (title && startIso && endIso) evOut.push({ title, startISO: startIso, endISO: endIso, ...(notes ? { notes } : {}) });
      if (evOut.length >= 10) break;
    }
    if (evOut.length) out.events = evOut;
    return out;
  } catch { return null; }
}

function getEnvBool(name, dflt = false) {
  try {
    const v = String(process.env[name] ?? '').toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes') return true;
    if (v === '0' || v === 'false' || v === 'no') return false;
    return dflt;
  } catch { return dflt; }
}

// Minimal SigV4 POST to AWS JSON services (e.g., Secrets Manager)
function sigv4PostJson({ service, region, target, bodyObj, hostOverride }) {
  return new Promise((resolve, reject) => {
    try {
      const serviceRegion = region || AWS_REGION || 'us-east-1';
      const host = hostOverride || `${service}.${serviceRegion}.amazonaws.com`;
      const path = '/';
      const method = 'POST';
      const body = JSON.stringify(bodyObj || {});
      const accessKey = process.env.AWS_ACCESS_KEY_ID;
      const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
      const sessionToken = process.env.AWS_SESSION_TOKEN;
      if (!accessKey || !secretKey) {
        return reject(new Error('Missing AWS credentials for SigV4 request'));
      }
      const now = new Date();
      const amzdate = now.toISOString().replace(/[:-]|\..*/g, '').slice(0, 15) + 'Z';
      const datestamp = amzdate.slice(0, 8);
      const canonicalUri = path;
      const canonicalQuerystring = '';
      const canonicalHeaders = `content-type:application/x-amz-json-1.1\n` + `host:${host}\n` + `x-amz-date:${amzdate}\n` + (sessionToken ? `x-amz-security-token:${sessionToken}\n` : '') + (target ? `x-amz-target:${target}\n` : '');
      const signedHeaders = sessionToken ? 'content-type;host;x-amz-date;x-amz-security-token' + (target ? ';x-amz-target' : '') : 'content-type;host;x-amz-date' + (target ? ';x-amz-target' : '');
      const payloadHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
      const canonicalRequest = [method, canonicalUri, canonicalQuerystring, canonicalHeaders, signedHeaders, payloadHash].join('\n');
      const algorithm = 'AWS4-HMAC-SHA256';
      const credentialScope = `${datestamp}/${serviceRegion}/${service}/aws4_request`;
      const stringToSign = [algorithm, amzdate, credentialScope, crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')].join('\n');
      function hmac(key, data) { return crypto.createHmac('sha256', key).update(data, 'utf8').digest(); }
      const kDate = hmac(`AWS4${secretKey}`, datestamp);
      const kRegion = hmac(kDate, serviceRegion);
      const kService = hmac(kRegion, service);
      const kSigning = hmac(kService, 'aws4_request');
      const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
      const authorizationHeader = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      const headers = {
        'Content-Type': 'application/x-amz-json-1.1',
        'Host': host,
        'X-Amz-Date': amzdate,
        'Authorization': authorizationHeader,
      };
      if (sessionToken) headers['X-Amz-Security-Token'] = sessionToken;
      if (target) headers['X-Amz-Target'] = target;
      const options = { hostname: host, path, method, headers, timeout: 2000, port: 443 };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
        });
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { try { req.destroy(new Error('Request timeout')); } catch {} });
      req.write(body);
      req.end();
    } catch (e) { reject(e); }
  });
}

async function getOpenAIKey() {
  const inline = String(process.env.OPENAI_API_KEY || '').trim();
  if (inline) { dbg('OPENAI_API_KEY present (len):', inline.length); return inline; }
  const arn = String(process.env.OPENAI_SECRET_ARN || '').trim();
  if (!arn) return '';
  // Try to detect region from ARN if provided
  let regionFromArn = undefined;
  try {
    const m = /^arn:aws:secretsmanager:([a-z0-9-]+):\d{12}:secret:\S+$/i.exec(arn);
    if (m && m[1]) regionFromArn = m[1];
  } catch {}
  try {
    const res = await sigv4PostJson({ service: 'secretsmanager', region: regionFromArn || AWS_REGION, target: 'secretsmanager.GetSecretValue', bodyObj: { SecretId: arn }, hostOverride: regionFromArn ? `secretsmanager.${regionFromArn}.amazonaws.com` : undefined });
    const str = res?.SecretString || '';
    if (!str) return '';
    try {
      const obj = JSON.parse(str);
      const k = obj.apiKey || obj.OPENAI_API_KEY || obj.key || '';
      dbg('OPENAI_SECRET_ARN fetched (len):', String(k||'').length);
      return k;
    } catch { return str; }
  } catch (e) {
    dbg('getOpenAIKey failed', e?.message || e);
    return '';
  }
}

async function callOpenAIJson({ model, messages, timeoutMs = 6000, apiKey }) {
  return new Promise((resolve) => {
    try {
      const host = 'api.openai.com';
      const path = '/v1/chat/completions';
      const body = JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      });
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) };
      const options = { hostname: host, path, method: 'POST', headers, timeout: timeoutMs, port: 443 };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data || '{}');
            const content = json?.choices?.[0]?.message?.content || '';
            resolve({ ok: true, content, raw: json, status: res.statusCode });
          } catch (e) {
            resolve({ ok: false, error: 'Non-JSON response', status: res.statusCode });
          }
        });
      });
      req.on('error', () => resolve({ ok: false, error: 'Network error' }));
      req.on('timeout', () => { try { req.destroy(new Error('Request timeout')); } catch {}; resolve({ ok: false, error: 'Timeout' }); });
      req.write(body);
      req.end();
    } catch (e) { resolve({ ok: false, error: e?.message || 'Unexpected' }); }
  });
}

function httpGetJson({ host, path, timeoutMs = 2500 }) {
  return new Promise((resolve, reject) => {
    try {
      const options = { hostname: host, path, method: 'GET', headers: { 'Content-Type': 'application/json' }, timeout: timeoutMs, port: 443 };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
        });
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { try { req.destroy(new Error('Request timeout')); } catch {}; reject(new Error('Timeout')); });
      req.end();
    } catch (e) { reject(e); }
  });
}

function detectDinnerIntent(s) {
  const t = String(s || '').toLowerCase();
  return /(what\s*'s|whats)\s+for\s+dinner|\bdinner\b|\bmake\s+a\s+recipe\b|\brecipe\b/.test(t);
}

async function fetchRecipes({ prefs, hint, budgetMs = 3500 }) {
  const started = Date.now();
  async function timeLeft() { return Math.max(0, budgetMs - (Date.now() - started)); }
  try {
    // Strategy: vegetarian category if pref set; else try ingredient filter from hint token; else default to chicken
    let list = [];
    try {
      if (prefs && (prefs.vegetarian === true || String(prefs.vegetarian).toLowerCase() === 'true')) {
        const res = await httpGetJson({ host: 'www.themealdb.com', path: '/api/json/v1/1/filter.php?c=Vegetarian', timeoutMs: await timeLeft() });
        list = Array.isArray(res?.meals) ? res.meals.slice(0, 6) : [];
      }
    } catch {}
    if (!list.length) {
      let ing = '';
      try {
        const m = /(with|using)\s+([a-zA-Z]+)/.exec(String(hint||''));
        if (m && m[2]) ing = m[2].toLowerCase();
      } catch {}
      if (!ing) {
        const m2 = /ingredient\s*[:=]\s*([a-zA-Z]+)/.exec(String(hint||''));
        if (m2 && m2[1]) ing = m2[1].toLowerCase();
      }
      if (!ing) ing = 'chicken';
      try {
        const res2 = await httpGetJson({ host: 'www.themealdb.com', path: `/api/json/v1/1/filter.php?i=${encodeURIComponent(ing)}` , timeoutMs: await timeLeft() });
        list = Array.isArray(res2?.meals) ? res2.meals.slice(0, 6) : [];
      } catch {}
    }
    const take = list.slice(0, 3);
    const details = [];
    for (const m of take) {
      if (await timeLeft() < 600) break;
      try {
        const d = await httpGetJson({ host: 'www.themealdb.com', path: `/api/json/v1/1/lookup.php?i=${encodeURIComponent(m.idMeal)}`, timeoutMs: await timeLeft() });
        const meal = Array.isArray(d?.meals) ? d.meals[0] : null;
        if (meal) {
          const ingredients = [];
          for (let i = 1; i <= 20; i++) {
            const ing = (meal[`strIngredient${i}`] || '').trim();
            const meas = (meal[`strMeasure${i}`] || '').trim();
            if (ing) ingredients.push(meas ? `${meas} ${ing}` : ing);
          }
          const steps = String(meal.strInstructions || '').split(/\.(?:\s+|$)/).map(s => s.trim()).filter(Boolean).slice(0, 5);
          details.push({ title: meal.strMeal || m.strMeal, ingredients, steps });
        }
      } catch {}
    }
    return details;
  } catch { return []; }
}

async function loadLatestPreferences(conversationId, jwt) {
  try {
    const sys = await getRecentSystemMessages(conversationId, jwt, 200);
    const latest = (sys || []).reverse().find(x => { try { const m = toObjectJson(x?.metadata); return m?.type === 'preferences'; } catch { return false; } });
    const data = (() => { try { const m = toObjectJson(latest?.metadata); return m?.data || {}; } catch { return {}; } })();
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}

async function createSystemMetadataMessage(conversationId, jwt, metadataObj, content, attachmentsArr) {
  return createAssistantMessage(conversationId, content, jwt, metadataObj, attachmentsArr, 'SYSTEM');
}

async function getRecentSystemMessages(conversationId, jwt, limit = 200) {
  const items = await getRecentMessages(conversationId, limit, jwt);
  return (items || []).filter(x => (x?.messageType === 'SYSTEM') || !!x?.metadata);
}

exports.handler = async (event) => {
  try {
    console.log('[assistant] handler invoked');
    console.log('[assistant] code version:', CODE_VERSION);
    console.log('[assistant] env region:', AWS_REGION, 'endpoint set:', !!APPSYNC_ENDPOINT, 'debug:', String(process.env.DEBUG_LOGS||'').toLowerCase());
    // Detect API Gateway shapes: REST (v1) has httpMethod; HTTP API (v2) has requestContext.http.method
    const isHttpV1 = !!event?.httpMethod;
    const isHttpV2 = !!event?.requestContext?.http?.method;
    const isHttp = isHttpV1 || isHttpV2;
    let rawBody = isHttp ? event.body : event;
    if (isHttp && event?.isBase64Encoded && typeof rawBody === 'string') {
      try { rawBody = Buffer.from(rawBody, 'base64').toString('utf8'); } catch {}
    }
    const ct = (event?.headers?.['content-type'] || event?.headers?.['Content-Type'] || '').toString();
    console.log('[assistant] event httpV1:', isHttpV1, 'httpV2:', isHttpV2, 'b64:', !!event?.isBase64Encoded, 'ct:', ct, 'raw body len:', (typeof rawBody === 'string' ? rawBody.length : JSON.stringify(rawBody||{}).length));
    let body = {};
    if (isHttp) {
      try {
        body = typeof rawBody === 'string' ? (rawBody ? JSON.parse(rawBody) : {}) : (rawBody || {});
      } catch (e) {
        console.warn('[assistant] JSON parse failed for body');
        body = {};
      }
      // Handle double-encoded JSON bodies (stringified twice)
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch {}
      }
    } else {
      body = event || {};
    }
    const { requestId, conversationId, userId, text, jwt, tz, calendarEvents } = body || {};
    console.log('[assistant] payload:', { requestId, conversationId, userId, textLen: (text||'').length, hasJwt: !!jwt, tz, calendarEventsCount: Array.isArray(calendarEvents) ? calendarEvents.length : 0 });

    if (!conversationId || !userId) {
      return respond(isHttp, 400, { ok: false, error: 'Missing conversationId or userId' });
    }
    if (requestId) {
      const key = `${conversationId}:${requestId}`;
      if (seen.has(key)) return respond(isHttp, 200, { ok: true, dedup: true });
      // prune occasionally
      if (seen.size > 1000) { seen.clear(); }
      seen.add(key);
    }

    // Feature flags
    const ASSISTANT_OPENAI_ENABLED = getEnvBool('ASSISTANT_OPENAI_ENABLED', false);
    const ASSISTANT_RECIPE_ENABLED = getEnvBool('ASSISTANT_RECIPE_ENABLED', false);
    const ASSISTANT_DECISIONS_ENABLED = getEnvBool('ASSISTANT_DECISIONS_ENABLED', false);
    const ASSISTANT_CONFLICTS_ENABLED = getEnvBool('ASSISTANT_CONFLICTS_ENABLED', false);
    const ASSISTANT_CALENDAR_CONFLICTS_ENABLED = getEnvBool('ASSISTANT_CALENDAR_CONFLICTS_ENABLED', false);
    const ASSISTANT_PRIORITY_ENABLED = getEnvBool('ASSISTANT_PRIORITY_ENABLED', false);
    const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-4o-mini');
    
    // Validate and sanitize calendar events
    let validatedCalendarEvents = [];
    if (ASSISTANT_CALENDAR_CONFLICTS_ENABLED && Array.isArray(calendarEvents)) {
      try {
        for (const evt of calendarEvents) {
          if (evt && typeof evt === 'object' && evt.startISO && evt.endISO) {
            const start = new Date(evt.startISO).getTime();
            const end = new Date(evt.endISO).getTime();
            if (Number.isFinite(start) && Number.isFinite(end) && start < end) {
              validatedCalendarEvents.push({ startISO: evt.startISO, endISO: evt.endISO });
            }
          }
        }
        console.log('[calendar] Validated', validatedCalendarEvents.length, 'events from', calendarEvents.length, 'received');
      } catch (e) {
        console.warn('[calendar] Validation failed:', e?.message || e);
      }
    }

    // Single tool: get recent messages
    let recent = [];
    try { recent = await getRecentMessages(conversationId, 10, jwt); } catch (e) { console.warn('[assistant] getRecentMessages failed:', e?.message || e); }
    // Prefer the current request text to avoid eventual consistency gaps
    const lastUserMessage = (text && String(text).trim()) ? String(text) : ((recent || []).find((m) => m?.senderId === userId)?.content || '');

    // Precompute decisions once (flag-gated). Include current text to avoid eventual consistency gaps.
    let decisionsMetaGlobal = undefined; let decisionsAttachGlobal = undefined;
    if (ASSISTANT_DECISIONS_ENABLED) {
      try {
        const scan = Array.isArray(recent) ? recent.slice() : [];
        if (text && typeof text === 'string' && text.trim()) {
          scan.unshift({ content: String(text), senderId: userId, createdAt: new Date().toISOString() });
        }
        const decisions = extractDecisionsFromRecent(scan, userId);
        const count = Array.isArray(decisions) ? decisions.length : 0;
        try { logMetric('decisions_extracted', count); } catch {}
        if (count) {
          decisionsMetaGlobal = { decisions };
          try { decisionsAttachGlobal = 'decisions:' + JSON.stringify({ decisions }); } catch {}
        }
      } catch {}
    }

    // Lightweight command handling (preferences & lists)
    const lower = String(text || '').toLowerCase();
    if (lower.startsWith('set preferences:')) {
      const kv = text.slice('set preferences:'.length).trim();
      const prefs = parseKeyValueCsv(kv);
      // store both metadata and attachment sentinel for easy retrieval
      const prefPayloadStr = (()=>{try{return JSON.stringify({ data:prefs});}catch{return '{}';}})();
      const attach = 'pref:'+prefPayloadStr;
      const contentPref = `[assistant:pref] pref:${prefPayloadStr}`;
      await createSystemMetadataMessage(conversationId, jwt, { type: 'preferences', data: prefs }, contentPref, [attach]);
      const kvLines = Object.keys(prefs).map(k=>`• ${k}=${prefs[k]}`);
      const ack = `${ASSISTANT_REPLY_PREFIX} Saved preferences.\n${kvLines.length?kvLines.join('\\n'):''}`;
      const posted = await createAssistantMessage(conversationId, ack, jwt, undefined, undefined, 'TEXT');
      console.log('[assistant] pref saved id:', posted?.id || '(none)');
      return respond(isHttp, 200, { ok: true });
    }
    if (lower.startsWith('show preferences')) {
      // First, parse directly from the user's most recent "Set preferences:" to avoid eventual consistency
      try {
        const recentForParse = await getRecentMessages(conversationId, 50, jwt);
        dbg('showPrefs: recentForParse length =', (recentForParse||[]).length);
        const lastSet = (recentForParse||[]).find(m => String(m?.content||'').toLowerCase().startsWith('set preferences:'));
        dbg('showPrefs: lastSet found =', !!lastSet);
        if (lastSet) {
          const raw = String(lastSet.content).slice('set preferences:'.length).trim();
          const parsed = parseKeyValueCsv(raw);
          dbg('showPrefs: parsed from lastSet =', parsed);
          if (Object.keys(parsed).length) {
            const lines = Object.keys(parsed).map(k => `• ${k}=${parsed[k]}`);
            const ack = `${ASSISTANT_REPLY_PREFIX} Preferences:\n${lines.length?lines.join('\\n'):'(none)'}`;
            const posted = await createAssistantMessage(conversationId, ack, jwt, undefined, undefined, 'TEXT');
            console.log('[assistant] pref show (from lastSet) id:', posted?.id || '(none)');
            return respond(isHttp, 200, { ok: true });
          }
        }
      } catch {}
      const sys = await getRecentSystemMessages(conversationId, jwt, 200);
      dbg('showPrefs: system messages length =', (sys||[]).length);
      let latest = (sys || []).reverse().find(x => { try { const m = toObjectJson(x?.metadata); return m?.type === 'preferences'; } catch { return false; } });
      let data = (() => { try { const m = toObjectJson(latest?.metadata); return m?.data || {}; } catch { return {}; } })();
      if (!Object.keys(data).length) {
        // fallback: scan attachments for pref sentinel
        try {
          const hit = (sys||[]).find(x => Array.isArray(x.attachments) && x.attachments.find(a=> typeof a==='string' && a.startsWith('pref:')));
          dbg('showPrefs: sys attachmentHit =', !!hit);
          if (hit) {
            const raw = String(hit.attachments.find(a=>String(a).startsWith('pref:'))).slice('pref:'.length);
            const obj = JSON.parse(raw);
            if (obj?.data) data = obj.data;
          }
        } catch {}
      }
      if (!Object.keys(data).length) {
        // fallback: parse from content token
        try {
          const withToken = (sys||[]).find(x => typeof x.content === 'string' && x.content.includes('pref:'));
          dbg('showPrefs: sys contentTokenHit =', !!withToken);
          if (withToken) {
            const idx = withToken.content.indexOf('pref:');
            const token = withToken.content.slice(idx + 'pref:'.length).trim();
            const obj = JSON.parse(token);
            if (obj?.data) data = obj.data;
          }
        } catch {}
      }
      if (!Object.keys(data).length) {
        // final scan across all recent messages (not only system-filtered)
        try {
          const all = await getRecentMessages(conversationId, 200, jwt);
          dbg('showPrefs: all messages length =', (all||[]).length);
          const withAttach = (all||[]).find(x => Array.isArray(x.attachments) && x.attachments.find(a=> typeof a==='string' && String(a).startsWith('pref:')));
          dbg('showPrefs: all attachmentHit =', !!withAttach);
          if (withAttach) {
            const raw = String(withAttach.attachments.find(a=>String(a).startsWith('pref:'))).slice('pref:'.length);
            const obj = JSON.parse(raw);
            if (obj?.data) data = obj.data;
          }
          if (!Object.keys(data).length) {
            const withToken2 = (all||[]).find(x => typeof x.content === 'string' && x.content.includes('pref:'));
            dbg('showPrefs: all contentTokenHit =', !!withToken2);
            if (withToken2) {
              const idx2 = withToken2.content.indexOf('pref:');
              const token2 = withToken2.content.slice(idx2 + 'pref:'.length).trim();
              const obj2 = JSON.parse(token2);
              if (obj2?.data) data = obj2.data;
            }
          }
          if (!Object.keys(data).length) {
            // parse from last assistant ack “Saved preferences.” lines (• k=v)
            const ack = (all||[]).find(x => x?.senderId === ASSISTANT_BOT_USER_ID && typeof x.content === 'string' && x.content.includes('Saved preferences'));
            dbg('showPrefs: assistant ackHit =', !!ack);
            if (ack) {
              const textLines = String(ack.content).replace(/\n/g, '\n');
              const lines = textLines.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
              const kv = {};
              for (const line of lines) {
                const m = /^•\s*([^=]+)=(.+)$/.exec(line);
                if (m) kv[m[1].trim()] = m[2].trim();
              }
              if (Object.keys(kv).length) data = kv;
            }
          }
        } catch {}
      }
      if (!Object.keys(data).length) {
        // final fallback: parse the user's last "Set preferences:" command directly
        try {
          const recentForParse = await getRecentMessages(conversationId, 50, jwt);
          const lastSet = (recentForParse||[]).find(m => String(m?.content||'').toLowerCase().startsWith('set preferences:'));
          if (lastSet) {
            const raw = String(lastSet.content).slice('set preferences:'.length).trim();
            const parsed = parseKeyValueCsv(raw);
            if (Object.keys(parsed).length) data = parsed;
          }
        } catch {}
      }
      const lines = Object.keys(data).map(k => `• ${k}=${data[k]}`);
      const ack = `${ASSISTANT_REPLY_PREFIX} Preferences:\n${lines.length?lines.join('\\n'):'(none)'}`;
      const posted = await createAssistantMessage(conversationId, ack, jwt, undefined, undefined, 'TEXT');
      console.log('[assistant] pref show id:', posted?.id || '(none)');
      return respond(isHttp, 200, { ok: true });
    }
    if (lower.startsWith('save list ')) {
      // save list Title: item1, item2
      const rest = text.slice('save list'.length).trim();
      const [titlePart, itemsPart] = rest.split(':');
      const title = (titlePart||'').trim();
      const items = String(itemsPart||'').split(',').map(s=>s.trim()).filter(Boolean);
      const id = normalizeTitle(title);
      const payloadStr = packListPayload(id, title, items);
      await createSystemMetadataMessage(
        conversationId,
        jwt,
        { type: 'list', id, title, items },
        '[assistant:list] list:' + payloadStr,
        ['list:' + payloadStr]
      );
      const ack = `${ASSISTANT_REPLY_PREFIX} Saved list “${title}” with ${items.length} item(s).`;
      await createAssistantMessage(conversationId, ack, jwt);
      return respond(isHttp, 200, { ok: true });
    }
    if (lower.startsWith('add to list ')) {
      // add to list Title: item1, item2
      const rest = text.slice('add to list'.length).trim();
      const [titlePart, itemsPart] = rest.split(':');
      const title = (titlePart||'').trim();
      const addItems = String(itemsPart||'').split(',').map(s=>s.trim()).filter(Boolean);
      const id = normalizeTitle(title);
      const sys = await getRecentSystemMessages(conversationId, jwt, 100);
      const existing = (sys||[]).reverse().find(x=>{ try{ const m=toObjectJson(x?.metadata); return m?.type==='list' && m?.id===id;}catch{return false;} });
      const curr = (()=>{try{ return toObjectJson(existing?.metadata); }catch{return {}}})();
      const nextItems = Array.from(new Set([...(curr.items||[]), ...addItems]));
      const payloadStr2 = packListPayload(id, title, nextItems);
      await createSystemMetadataMessage(
        conversationId,
        jwt,
        { type: 'list', id, title, items: nextItems },
        '[assistant:list] list:' + payloadStr2,
        ['list:' + payloadStr2]
      );
      const ack = `${ASSISTANT_REPLY_PREFIX} Updated “${title}” (${nextItems.length} items).`;
      await createAssistantMessage(conversationId, ack, jwt);
      return respond(isHttp, 200, { ok: true });
    }
    if (lower.startsWith('show list ')) {
      const title = text.slice('show list'.length).trim();
      const id = normalizeTitle(title);
      const sys = await getRecentSystemMessages(conversationId, jwt, 100);
      const existing = (sys||[]).reverse().find(x=>{ try{ const m=toObjectJson(x?.metadata); return m?.type==='list' && m?.id===id;}catch{return false;} });
      // Attempt metadata first
      let items = (()=>{ try { const c = toObjectJson(existing?.metadata); return Array.isArray(c?.items) ? c.items : []; } catch { return []; } })();
      // Attachment sentinel fallback
      if (!items.length && Array.isArray(existing?.attachments)) {
        try {
          const hit = existing.attachments.find(a => typeof a === 'string' && a.startsWith('list:'));
          if (hit) { const obj = JSON.parse(hit.slice('list:'.length)); if (obj?.id === id && Array.isArray(obj.items)) items = obj.items; }
        } catch {}
      }
      // Content token fallback
      if (!items.length && typeof existing?.content === 'string' && existing.content.includes('list:')) {
        try {
          const idx = existing.content.indexOf('list:');
          const obj = JSON.parse(existing.content.slice(idx + 'list:'.length).trim());
          if (obj?.id === id && Array.isArray(obj.items)) items = obj.items;
        } catch {}
      }
      // Final scan across all recent messages
      if (!items.length) {
        try {
          const all = await getRecentMessages(conversationId, 200, jwt);
          const withAttach = (all||[]).reverse().find(x => Array.isArray(x.attachments) && x.attachments.some(a => typeof a === 'string' && String(a).startsWith('list:')));
          if (withAttach) {
            const raw = String(withAttach.attachments.find(a => String(a).startsWith('list:'))).slice('list:'.length);
            const obj = JSON.parse(raw);
            if (obj?.id === id && Array.isArray(obj.items)) items = obj.items;
          }
          if (!items.length) {
            const withToken = (all||[]).reverse().find(x => typeof x.content === 'string' && x.content.includes('list:'));
            if (withToken) {
              const idx = withToken.content.indexOf('list:');
              const obj = JSON.parse(withToken.content.slice(idx + 'list:'.length).trim());
              if (obj?.id === id && Array.isArray(obj.items)) items = obj.items;
            }
          }
        } catch {}
      }
      const lines = (items||[]).map((s)=>`• ${s}`);
      const ack = `${ASSISTANT_REPLY_PREFIX} List “${title}”:\n${lines.length?lines.join('\\n'):'(empty)'}`;
      await createAssistantMessage(conversationId, ack, jwt);
      return respond(isHttp, 200, { ok: true });
    }
    if (lower.startsWith('list lists')) {
      const sys = await getRecentSystemMessages(conversationId, jwt, 200);
      const seen = new Map();
      for (const x of sys) {
        try {
          const m = toObjectJson(x?.metadata);
          if (m?.type==='list' && m?.id) seen.set(m.id, m.title||m.id);
          if (Array.isArray(x?.attachments)) {
            const hit = x.attachments.find(a => typeof a === 'string' && a.startsWith('list:'));
            if (hit) { const obj = JSON.parse(hit.slice('list:'.length)); if (obj?.id) seen.set(obj.id, obj.title||obj.id); }
          }
          if (typeof x?.content === 'string' && x.content.includes('list:')) {
            const idx = x.content.indexOf('list:');
            const obj = JSON.parse(x.content.slice(idx + 'list:'.length).trim());
            if (obj?.id) seen.set(obj.id, obj.title||obj.id);
          }
        } catch {}
      }
      const titles = Array.from(seen.values());
      const ack = `${ASSISTANT_REPLY_PREFIX} Saved lists:\n${titles.length?titles.map(t=>`• ${t}`).join('\\n'):'(none)'}`;
      await createAssistantMessage(conversationId, ack, jwt);
      return respond(isHttp, 200, { ok: true });
    }

    // Explicit decision add: "Add decision: <title>"
    if (lower.startsWith('add decision:')) {
      const titleRaw = String(text || '').slice('add decision:'.length).trim();
      const title = titleRaw || 'Decision';
      const decision = {
        title: title.slice(0, 80),
        summary: title.slice(0, 200),
        participants: [userId],
        decidedAtISO: new Date().toISOString(),
      };
      const payloadStr = (() => { try { return JSON.stringify({ decisions: [decision] }); } catch { return '{}'; } })();
      // Persist as SYSTEM metadata and attachment; also attach to ack for immediate visibility
      await createSystemMetadataMessage(
        conversationId,
        jwt,
        { decisions: [decision] },
        '[assistant:decisions] decisions:' + payloadStr,
        ['decisions:' + payloadStr]
      );
      const ack = `${ASSISTANT_REPLY_PREFIX} Recorded decision "${title}".`;
      await createAssistantMessage(conversationId, ack, jwt, { decisions: [decision] }, ['decisions:' + payloadStr], 'TEXT');
      try { logMetric('decisions_recorded', 1); } catch {}
      return respond(isHttp, 200, { ok: true });
    }

    // Deterministic decisions listing (no OpenAI)
    try { dbg('incoming lower =', lower); } catch {}
    const isDecisionsCmd = /\b(?:show|list|view|see)\s+(?:recent\s+)?decisions?\b|\bshow\s+updates?\b|\bdecisions\s+please\b/i.test(lower);
    if (isDecisionsCmd) {
      console.log('[assistant] decisions command matched');
      try {
        let decisions = [];
        let recentMsgs = [];
        // Retry recent fetch + extraction within a strict time budget (to avoid Lambda timeouts)
        const budgetMs = (() => { try { const n = parseInt(process.env.DECISIONS_LIST_BUDGET_MS || '', 10); return Number.isFinite(n) && n > 0 ? Math.min(n, 7000) : 3000; } catch { return 3000; } })();
        const deadline = Date.now() + budgetMs;
        let attempt = 0;
        while (Date.now() < deadline && attempt < 6) {
          try { recentMsgs = await getRecentMessages(conversationId, 200, jwt); } catch { recentMsgs = []; }
          // Debug sample of fetched message shapes (gated by DEBUG_LOGS)
          try {
            dbg('decisions:list recent length =', (recentMsgs||[]).length);
            const sample = (recentMsgs||[]).slice(0, 8).map((m)=>{
              let attType = typeof m?.attachments;
              let attPreview = undefined;
              try {
                if (Array.isArray(m?.attachments)) {
                  attType = 'array';
                  attPreview = m.attachments.slice(0,2).map((a)=> typeof a === 'string' ? a.slice(0,40) : '[obj]');
                } else if (typeof m?.attachments === 'string') {
                  attType = 'string';
                  attPreview = String(m.attachments).slice(0, 60);
                }
              } catch {}
              const metaObj = (()=>{ try { return toObjectJson(m?.metadata); } catch { return {}; } })();
              return {
                id: m?.id,
                senderId: m?.senderId,
                type: m?.messageType,
                content: String(m?.content||'').slice(0, 60),
                metaKeys: Object.keys(metaObj||{}),
                metaHasDecisions: !!(Array.isArray(metaObj?.decisions) && metaObj.decisions.length),
                attType,
                attPreview,
              };
            });
            dbg('decisions:list sample =', JSON.stringify(sample));
          } catch {}
          // 1) Prefer explicit decisions stored in metadata or attachment
          try {
            const collected = [];
            for (const m of (recentMsgs || [])) {
              try {
                const meta = toObjectJson(m?.metadata);
                if (Array.isArray(meta?.decisions) && meta.decisions.length) {
                  collected.push(...meta.decisions);
                }
                // Normalize attachments from AWSJSON (string or array)
                let atts = [];
                try {
                  if (Array.isArray(m?.attachments)) atts = m.attachments;
                  else if (typeof m?.attachments === 'string') {
                    const parsed = JSON.parse(m.attachments);
                    if (Array.isArray(parsed)) atts = parsed;
                  }
                } catch {}
                if (Array.isArray(atts) && atts.length) {
                  const hit = atts.find((a) => {
                    try {
                      if (typeof a === 'string') return String(a).startsWith('decisions:');
                      if (a && typeof a === 'object') {
                        const s = JSON.stringify(a);
                        return s.startsWith('{"decisions":') || s.includes('"decisions":');
                      }
                      return false;
                    } catch { return false; }
                  });
                  if (hit) {
                    try {
                      const raw = typeof hit === 'string' ? String(hit).slice('decisions:'.length) : JSON.stringify(hit);
                      const obj = JSON.parse(raw);
                      if (Array.isArray(obj?.decisions) && obj.decisions.length) collected.push(...obj.decisions);
                    } catch {}
                  }
                }
                // Content token fallback: decisions:<json> embedded in message content
                if (typeof m?.content === 'string' && m.content.includes('decisions:')) {
                  try {
                    const idx = m.content.indexOf('decisions:');
                    const jsonPart = m.content.slice(idx + 'decisions:'.length).trim();
                    const obj = JSON.parse(jsonPart);
                    if (Array.isArray(obj?.decisions) && obj.decisions.length) collected.push(...obj.decisions);
                  } catch {}
                }
              } catch {}
              if (collected.length >= 20) break;
            }
            if (collected.length) { decisions = collected; }
          } catch {}
          // 2) Fallback: extract from message content
          if (!(Array.isArray(decisions) && decisions.length)) {
            try { decisions = extractDecisionsFromRecent(recentMsgs || [], userId) || []; } catch { decisions = []; }
          }
          // 3) Ultra-permissive content scan
          if (!Array.isArray(decisions) || !decisions.length) {
            try {
              const patt = /(decid|decision|recorded\s+decision|agreed|go\s+with|chose|choose|assistant:decisions)/i;
              const hits = [];
              for (const m of (recentMsgs || [])) {
                const txt = String(m?.content || '');
                if (patt.test(txt)) {
                  hits.push({
                    title: txt.slice(0, 80),
                    summary: txt.slice(0, 200),
                    participants: m?.senderId ? [m.senderId] : [],
                    decidedAtISO: (()=>{ try { return new Date(m.createdAt).toISOString(); } catch { return new Date().toISOString(); } })(),
                  });
                  if (hits.length >= 10) break;
                }
              }
              if (hits.length) decisions = hits;
            } catch {}
          }
          // 4) Targeted parse of 'Recorded decision "X"' in assistant messages
          if (!Array.isArray(decisions) || !decisions.length) {
            try {
              const rx = /recorded\s+decision\s+\"([^\"]+)\"/i;
              const hits = [];
              for (const m of (recentMsgs || [])) {
                try {
                  if (m?.senderId !== ASSISTANT_BOT_USER_ID) continue;
                  const txt = String(m?.content || '');
                  const mm = rx.exec(txt);
                  if (mm && mm[1]) {
                    hits.push({
                      title: String(mm[1]).slice(0, 80),
                      summary: txt.slice(0, 200),
                      participants: [],
                      decidedAtISO: (()=>{ try { return new Date(m.createdAt).toISOString(); } catch { return new Date().toISOString(); } })(),
                    });
                    if (hits.length >= 10) break;
                  }
                } catch {}
              }
              if (hits.length) decisions = hits;
            } catch {}
          }
          if (Array.isArray(decisions) && decisions.length) break;
          // short backoff within remaining budget
          const now = Date.now();
          const remaining = Math.max(0, deadline - now);
          if (remaining <= 0) break;
          const delay = Math.min(400, remaining);
          await new Promise(r => setTimeout(r, delay));
          attempt++;
        }
        const top = (decisions || []).slice(0, 10);
        if (!top.length) {
          // Final fallback: list last assistant messages that look like decisions
          try {
            const patt2 = /(decid|agreed|go\s+with|chose|choose)/i;
            const fallbacks = (recentMsgs || [])
              .filter(m => m?.senderId === ASSISTANT_BOT_USER_ID && patt2.test(String(m?.content || '')))
              .slice(0, 5)
              .map(m => ({
                title: String(m.content || '').slice(0, 80),
                summary: String(m.content || '').slice(0, 200),
                participants: [],
                decidedAtISO: (()=>{ try { return new Date(m.createdAt).toISOString(); } catch { return new Date().toISOString(); } })(),
              }));
            if (fallbacks.length) {
              const lines = fallbacks.map(d => `• ${d.title}`);
              const ack = `${ASSISTANT_REPLY_PREFIX} Recent decisions:\n${lines.join('\\n')}`;
              const attach = (() => { try { return 'decisions:' + JSON.stringify({ decisions: fallbacks }); } catch { return undefined; } })();
              await createAssistantMessage(conversationId, ack, jwt, { decisions: fallbacks }, attach ? [attach] : undefined, 'TEXT');
              try { logMetric('decisions_fallback_listed', fallbacks.length); } catch {}
              return respond(isHttp, 200, { ok: true });
            }
          } catch {}
          const ack = `${ASSISTANT_REPLY_PREFIX} No recent decisions.`;
          await createAssistantMessage(conversationId, ack, jwt);
          return respond(isHttp, 200, { ok: true });
        }
        const lines = top.map((d) => `• ${String(d.title || d.summary || '').slice(0, 80)}`);
        const ack = `${ASSISTANT_REPLY_PREFIX} Recent decisions:\n${lines.join('\\n')}`;
        const attach = (() => { try { return 'decisions:' + JSON.stringify({ decisions: top }); } catch { return undefined; } })();
        await createAssistantMessage(
          conversationId,
          ack,
          jwt,
          { decisions: top },
          attach ? [attach] : undefined,
          'TEXT'
        );
        try { logMetric('decisions_listed', (top || []).length); } catch {}
        return respond(isHttp, 200, { ok: true });
      } catch (e) {
        const ack = `${ASSISTANT_REPLY_PREFIX} No recent decisions.`;
        await createAssistantMessage(conversationId, ack, jwt);
        return respond(isHttp, 200, { ok: true });
      }
    }
    // Phase 2: Dinner intent retrieval (prioritize over Phase 1). Fallback to Phase 1 on failure.
    const dinnerIntent = ASSISTANT_RECIPE_ENABLED && detectDinnerIntent(lastUserMessage || text || '');
    if (dinnerIntent) {
      try {
        const prefs = await loadLatestPreferences(conversationId, jwt);
        const recs = await fetchRecipes({ prefs, hint: lastUserMessage || text || '', budgetMs: 3500 });
        if (Array.isArray(recs) && recs.length) {
          const summary = recs.map(r => `• ${r.title}`).join('\n');
          const content = `${ASSISTANT_REPLY_PREFIX} Here are a few quick dinner ideas:\n${summary}`;
          const attachRecipes = (() => { try { return 'recipes:' + JSON.stringify({ recipes: recs }); } catch { return undefined; } })();
          const decisionsMeta = decisionsMetaGlobal;
          const decisionsAttach = decisionsAttachGlobal;
          const attachments = [];
          if (attachRecipes) attachments.push(attachRecipes);
          if (decisionsAttach) attachments.push(decisionsAttach);
          const metadata = decisionsMeta ? { recipes: recs, ...decisionsMeta } : { recipes: recs };
          await createAssistantMessage(conversationId, content, jwt, metadata, attachments.length ? attachments : undefined, 'TEXT');
          return respond(isHttp, 200, { ok: true });
        }
      } catch {}
      // If we reach here, proceed to Phase 1 (OpenAI) or fallback
    }

    // Auto-save decisions on explicit phrases before calling OpenAI
    try {
      if (ASSISTANT_DECISIONS_ENABLED) {
        const t = String(text || '').toLowerCase();
        if (/\bwe\s+decided\b|\bdecided\s+to\b|\bwe\s+agreed\b|\bagreed\s+to\b|\bwe\s+(?:will|\'ll)\s+go\s+with\b|\bwe\s+chose\b|\bwe\s+choose\b/.test(t)) {
          const decision = {
            title: String(text || '').slice(0, 80),
            summary: String(text || '').slice(0, 200),
            participants: [userId],
            decidedAtISO: new Date().toISOString(),
          };
          const payloadStr = (() => { try { return JSON.stringify({ decisions: [decision] }); } catch { return '{}'; } })();
          await createSystemMetadataMessage(
            conversationId,
            jwt,
            { decisions: [decision] },
            '[assistant:decisions] decisions:' + payloadStr,
            ['decisions:' + payloadStr]
          );
          try { logMetric('decisions_autosaved', 1); } catch {}
        }
      }
    } catch {}

    // Attempt Phase 1 (OpenAI) if enabled and key available
    let openaiAttempted = false;
    if (ASSISTANT_OPENAI_ENABLED) {
      try {
        const key = await getOpenAIKey();
        if (key) {
          openaiAttempted = true;
          const prefs = await loadLatestPreferences(conversationId, jwt);
          const convo = (recent || []).slice(0, 10).map(m => ({ role: (m.senderId === userId ? 'user' : (m.senderId === ASSISTANT_BOT_USER_ID ? 'assistant' : 'user')), content: String(m.content || '').slice(0, 500) }));
          // Detect priority from user message
          const detectedPriority = ASSISTANT_PRIORITY_ENABLED ? detectPriority(text) : 'normal';
          
          const sys = {
            role: 'system',
            content: [
              'You are a concise planning assistant. Output ONLY compact JSON with keys: text (string), optional events (array of { title, startISO, endISO, notes? }).',
              'Use user preferences if present. Keep under 120 words. Do not include markdown. Times must be ISO8601.',
              ASSISTANT_CALENDAR_CONFLICTS_ENABLED && validatedCalendarEvents.length ? 'Avoid suggesting times that overlap with the user\'s existing calendar slots.' : '',
              ASSISTANT_PRIORITY_ENABLED ? 'If the user message indicates urgency (urgent, asap, critical, emergency), include "priority": "high" in your JSON response.' : '',
            ].filter(Boolean).join(' '),
          };
          // Build calendar context for OpenAI
          let calendarContext = '';
          if (ASSISTANT_CALENDAR_CONFLICTS_ENABLED && validatedCalendarEvents.length) {
            const slots = validatedCalendarEvents.slice(0, 20).map(e => {
              try {
                const start = new Date(e.startISO);
                const end = new Date(e.endISO);
                return `${start.toISOString().slice(0, 16)} to ${end.toISOString().slice(0, 16)}`;
              } catch {
                return null;
              }
            }).filter(Boolean);
            if (slots.length) {
              calendarContext = ` User's calendar has ${validatedCalendarEvents.length} occupied slots in next 14 days, including: ${slots.slice(0, 5).join('; ')}.`;
            }
          }
          const userMsg = { role: 'user', content: `Preferences: ${JSON.stringify(prefs||{})}. User timezone: ${tz || 'unknown'}. ${calendarContext} Latest user input: ${String(lastUserMessage||'').slice(0,500)}.` };
          const messages = [sys, ...convo.reverse(), userMsg];
          const res = await callOpenAIJson({ model: OPENAI_MODEL, messages, timeoutMs: 6000, apiKey: key });
          if (res?.ok && typeof res.content === 'string' && res.content.trim()) {
            let parsed = null;
            try { parsed = JSON.parse(res.content); } catch {}
            const validated = validateModelResponse(parsed);
            if (validated && typeof validated.text === 'string') {
              const modelText = validated.text;
              let events = Array.isArray(validated.events) ? validated.events : [];
              if (!events.length) {
                try {
                  const derived = parseEventsFromText(lastUserMessage || text || '', new Date());
                  if (Array.isArray(derived) && derived.length) {
                    events = derived;
                    try { logMetric('events_derived', derived.length); } catch {}
                  }
                } catch {}
              }
              let content = `${ASSISTANT_REPLY_PREFIX} ${modelText}`.trim();
              
              // Extract priority (from model or fallback to detected)
              let finalPriority = 'normal';
              if (ASSISTANT_PRIORITY_ENABLED) {
                finalPriority = validated.priority === 'high' ? 'high' : detectedPriority;
                if (finalPriority === 'high') {
                  try { logMetric('priority_detected', 1); } catch {}
                  console.log('[priority] High priority detected');
                }
              }
              
              // Optional: decision extraction on assistant replies
              let decisionsMeta = decisionsMetaGlobal;
              let decisionsAttach = decisionsAttachGlobal;
              if (!decisionsMeta && ASSISTANT_DECISIONS_ENABLED) {
                try {
                  const scan = [{ content: modelText, senderId: ASSISTANT_BOT_USER_ID, createdAt: new Date().toISOString() }, ...(Array.isArray(recent) ? recent : [])];
                  const decisions2 = extractDecisionsFromRecent(scan, userId);
                  if (Array.isArray(decisions2) && decisions2.length) {
                    decisionsMeta = { decisions: decisions2 };
                    try { decisionsAttach = 'decisions:' + JSON.stringify({ decisions: decisions2 }); } catch {}
                  }
                } catch {}
              }
              // Optional conflicts detection against prior assistant events + device calendar
              let conflictsMeta = undefined; let conflictsAttach = undefined;
              if (ASSISTANT_CONFLICTS_ENABLED && Array.isArray(events) && events.length) {
                try {
                  const prior = [];
                  // Include assistant events from recent messages
                  for (const m of (recent || [])) {
                    try {
                      const metaPrev = toObjectJson(m?.metadata);
                      if (Array.isArray(metaPrev?.events)) { prior.push(...metaPrev.events.map(e => ({...e, source: 'assistant'}))); }
                      if (Array.isArray(m?.attachments)) {
                        const hitPrev = m.attachments.find(a => typeof a==='string' && String(a).startsWith('events:'));
                        if (hitPrev) { const objPrev = JSON.parse(String(hitPrev).slice('events:'.length)); if (Array.isArray(objPrev?.events)) prior.push(...objPrev.events.map(e => ({...e, source: 'assistant'}))); }
                      }
                    } catch {}
                    if (prior.length >= 50) break;
                  }
                  // Include device calendar events if enabled
                  if (ASSISTANT_CALENDAR_CONFLICTS_ENABLED && validatedCalendarEvents.length) {
                    prior.push(...validatedCalendarEvents.map(e => ({ ...e, source: 'device' })));
                    console.log('[calendar] Added', validatedCalendarEvents.length, 'device events to conflict detection');
                  }
                  const overlaps = [];
                  let hasDeviceConflict = false;
                  for (let i = 0; i < events.length; i++) {
                    const e = events[i];
                    const s = new Date(e.startISO).getTime();
                    const en = new Date(e.endISO).getTime();
                    if (!Number.isFinite(s) || !Number.isFinite(en)) continue;
                    const hits = [];
                    for (const p of prior) {
                      const ps = new Date(p.startISO).getTime();
                      const pe = new Date(p.endISO).getTime();
                      if (!Number.isFinite(ps) || !Number.isFinite(pe)) continue;
                      if (s < pe && ps < en) {
                        hits.push({ startISO: p.startISO, endISO: p.endISO, source: p.source || 'assistant' });
                        if (p.source === 'device') hasDeviceConflict = true;
                        if (hits.length >= 3) break;
                      }
                    }
                    if (hits.length) overlaps.push({ eventIndex: i, conflicts: hits });
                    if (overlaps.length >= 10) break;
                  }
                  if (overlaps.length) {
                    conflictsMeta = { conflicts: overlaps };
                    try { conflictsAttach = 'conflicts:' + JSON.stringify({ conflicts: overlaps }); } catch {}
                    if (hasDeviceConflict) {
                      content = `${content}\n(Heads-up: Some proposed times conflict with existing events.)`;
                    } else {
                      content = `${content}\n(Heads-up: Some proposed times conflict with earlier plans.)`;
                    }
                  }
                } catch {}
              }

              try {
                const encEvents = (() => { try { return events.length ? 'events:' + JSON.stringify({ events }) : undefined; } catch { return undefined; } })();
                const attachments = [];
                if (encEvents) attachments.push(encEvents);
                if (decisionsAttach) attachments.push(decisionsAttach);
                if (conflictsAttach) attachments.push(conflictsAttach);
                const metadata = (() => {
                  const base = events.length ? { events } : {};
                  const withDecisions = decisionsMeta ? { ...base, ...decisionsMeta } : base;
                  const withPriority = (ASSISTANT_PRIORITY_ENABLED && finalPriority === 'high') ? { ...withDecisions, priority: finalPriority } : withDecisions;
                  if (conflictsMeta) return { ...withPriority, ...conflictsMeta };
                  return Object.keys(withPriority).length ? withPriority : undefined;
                })();
                const posted = await createAssistantMessage(conversationId, content, jwt, metadata, attachments.length ? attachments : undefined, 'TEXT');
                console.log('[assistant] reply (openai) posted id:', posted?.id || '(none)');
                logMetric('openai_success', 1);
                if (posted && (!posted.messageType || !posted.updatedAt)) { await ensureMessageFields(posted.id, jwt).catch(() => {}); }
                // Ensure metadata persisted even if backend ignores it on create
                try {
                  if (posted?.id && metadata && Object.keys(metadata).length) {
                    const u = /* GraphQL */ `
                      mutation UpdateMessage($input: UpdateMessageInput!) {
                        updateMessage(input: $input) { id }
                      }
                    `;
                    const input = { id: posted.id, metadata: JSON.stringify(metadata) };
                    await signAndRequest({ query: u, variables: { input }, opName: 'updateMessage(metadata)', jwt });
                  }
                } catch {}
                // Best-effort metadata update to handle backends that ignore metadata on create
                try {
                  if (posted?.id && metadata && Object.keys(metadata).length) {
                    const u = /* GraphQL */ `
                      mutation UpdateMessage($input: UpdateMessageInput!) {
                        updateMessage(input: $input) { id }
                      }
                    `;
                    const input = { id: posted.id, metadata: JSON.stringify(metadata) };
                    await signAndRequest({ query: u, variables: { input }, opName: 'updateMessage(metadata)', jwt });
                  }
                } catch {}
              } catch (e) { console.warn('[assistant] openai post failed:', e?.message || e); }
              return respond(isHttp, 200, { ok: true });
            }
            dbg('OpenAI content empty or invalid JSON. status=', res?.status, 'rawError=', res?.raw?.error?.message);
          }
          dbg('OpenAI call failed or empty. status=', res?.status, 'err=', res?.error);
          logMetric('openai_fallback', 1, { status: res?.status || 0 });
        }
      } catch (e) { console.warn('[assistant] OpenAI attempt failed:', e?.message || e); }
    }

    // Simple weekend plan template (fallback or when flag disabled)
    const plan = [
      'Sat 9:00 – Park stroll and coffee',
      'Sat 12:00 – Picnic (bring sandwiches + fruit)',
      'Sat 15:00 – Board games at home',
      'Sun 10:00 – Farmers market (grab veggies for dinner)',
      'Sun 13:00 – Quick pasta lunch',
    ];
    let content = `${ASSISTANT_REPLY_PREFIX} Here’s a simple weekend plan based on what I saw: \n` +
      `• Focus: ${(lastUserMessage || 'family time').slice(0, 60)}\n` +
      plan.map(p => `• ${p}`).join('\n');
    // Include simple events for optional calendar export
    const now = new Date();
    const day = (d) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const events = [
      { title: 'Park stroll and coffee', startISO: new Date(day(1).setHours(9,0,0,0)).toISOString(), endISO: new Date(day(1).setHours(10,0,0,0)).toISOString(), notes: 'Casual walk' },
      { title: 'Picnic lunch', startISO: new Date(day(1).setHours(12,0,0,0)).toISOString(), endISO: new Date(day(1).setHours(13,0,0,0)).toISOString(), notes: 'Bring sandwiches + fruit' },
      { title: 'Board games', startISO: new Date(day(1).setHours(15,0,0,0)).toISOString(), endISO: new Date(day(1).setHours(17,0,0,0)).toISOString(), notes: 'At home' },
      { title: 'Farmers market', startISO: new Date(day(2).setHours(10,0,0,0)).toISOString(), endISO: new Date(day(2).setHours(11,30,0,0)).toISOString(), notes: 'Grab veggies' },
      { title: 'Quick pasta lunch', startISO: new Date(day(2).setHours(13,0,0,0)).toISOString(), endISO: new Date(day(2).setHours(14,0,0,0)).toISOString(), notes: 'At home' },
    ];

    try {
      // Detect priority for fallback
      const detectedPriority = ASSISTANT_PRIORITY_ENABLED ? detectPriority(text) : 'normal';
      if (ASSISTANT_PRIORITY_ENABLED && detectedPriority === 'high') {
        console.log('[priority] High priority detected (fallback)');
        try { logMetric('priority_detected_fallback', 1); } catch {}
      }
      
      // Build attachments/metadata for events and optional decisions/conflicts
      const encEvents = (() => { try { return 'events:' + JSON.stringify({ events }); } catch { return undefined; } })();
      const decisionsMeta = decisionsMetaGlobal;
      const decisionsAttach = decisionsAttachGlobal;
      // Conflicts detection for fallback events (includes device calendar)
      let conflictsMeta = undefined; let conflictsAttach = undefined;
      if (ASSISTANT_CONFLICTS_ENABLED && Array.isArray(events) && events.length) {
        try {
          const prior = [];
          // Include assistant events from recent messages
          for (const m of (recent || [])) {
            try {
              const metaPrev = toObjectJson(m?.metadata);
              if (Array.isArray(metaPrev?.events)) { prior.push(...metaPrev.events.map(e => ({...e, source: 'assistant'}))); }
              if (Array.isArray(m?.attachments)) {
                const hitPrev = m.attachments.find(a => typeof a==='string' && String(a).startsWith('events:'));
                if (hitPrev) { const objPrev = JSON.parse(String(hitPrev).slice('events:'.length)); if (Array.isArray(objPrev?.events)) prior.push(...objPrev.events.map(e => ({...e, source: 'assistant'}))); }
              }
            } catch {}
            if (prior.length >= 50) break;
          }
          // Include device calendar events if enabled
          if (ASSISTANT_CALENDAR_CONFLICTS_ENABLED && validatedCalendarEvents.length) {
            prior.push(...validatedCalendarEvents.map(e => ({ ...e, source: 'device' })));
          }
          const overlaps = [];
          let hasDeviceConflict = false;
          for (let i = 0; i < events.length; i++) {
            const e = events[i];
            const s = new Date(e.startISO).getTime();
            const en = new Date(e.endISO).getTime();
            if (!Number.isFinite(s) || !Number.isFinite(en)) continue;
            const hits = [];
            for (const p of prior) {
              const ps = new Date(p.startISO).getTime();
              const pe = new Date(p.endISO).getTime();
              if (!Number.isFinite(ps) || !Number.isFinite(pe)) continue;
              if (s < pe && ps < en) {
                hits.push({ startISO: p.startISO, endISO: p.endISO, source: p.source || 'assistant' });
                if (p.source === 'device') hasDeviceConflict = true;
                if (hits.length >= 3) break;
              }
            }
            if (hits.length) overlaps.push({ eventIndex: i, conflicts: hits });
            if (overlaps.length >= 10) break;
          }
          if (overlaps.length) {
            conflictsMeta = { conflicts: overlaps };
            try { conflictsAttach = 'conflicts:' + JSON.stringify({ conflicts: overlaps }); } catch {}
            if (hasDeviceConflict) {
              content = `${content}\n(Heads-up: Some proposed times conflict with existing events.)`;
            } else {
              content = `${content}\n(Heads-up: Some proposed times conflict with earlier plans.)`;
            }
          }
        } catch {}
      }

      const attachments = [];
      if (encEvents) attachments.push(encEvents);
      if (decisionsAttach) attachments.push(decisionsAttach);
      if (conflictsAttach) attachments.push(conflictsAttach);
      const metadata = (() => {
        const base = { events };
        const withDecisions = decisionsMeta ? { ...base, ...decisionsMeta } : base;
        const withPriority = (ASSISTANT_PRIORITY_ENABLED && detectedPriority === 'high') ? { ...withDecisions, priority: detectedPriority } : withDecisions;
        if (conflictsMeta) return { ...withPriority, ...conflictsMeta };
        return withPriority;
      })();
      const posted = await createAssistantMessage(conversationId, content, jwt, metadata, attachments.length ? attachments : undefined, 'TEXT');
      console.log('[assistant] reply posted id:', posted?.id || '(none)');
      // If backend ignored fields, patch them immediately
      if (posted && (!posted.messageType || !posted.updatedAt)) {
        await ensureMessageFields(posted.id, jwt).catch(() => {});
      }
      // Best-effort metadata update for events (if supported by schema)
      try {
        if (events && events.length) {
          const u = /* GraphQL */ `
            mutation UpdateMessage($input: UpdateMessageInput!) {
              updateMessage(input: $input) { id }
            }
          `;
          const input = { id: posted.id, metadata: JSON.stringify(metadata) };
          await signAndRequest({ query: u, variables: { input }, opName: 'updateMessage(metadata)', jwt });
        }
      } catch {}
    } catch (e) {
      console.warn('[assistant] createMessage failed:', e?.message || e);
    }

    return respond(isHttp, 200, { ok: true });
  } catch (e) {
    console.warn('[assistant] error:', e?.message || e);
    return respond(!!event?.httpMethod, 200, { ok: true, warn: true });
  }
};

function respond(isHttp, statusCode, body) {
  if (!isHttp) return body;
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}


