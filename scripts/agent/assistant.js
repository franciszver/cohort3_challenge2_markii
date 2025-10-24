// Minimal Assistant Lambda handler (single-tool MVP)
// - POST /agent/weekend-plan
// - Tool: getRecentMessages via AppSync (IAM-signed)
// - Reply: echo last user message; post via createMessage as assistant-bot

const crypto = require('crypto');
const https = require('https');

const { APPSYNC_ENDPOINT, AWS_REGION = 'us-east-1', ASSISTANT_BOT_USER_ID = 'assistant-bot', ASSISTANT_REPLY_PREFIX = 'Assistant Echo:' } = process.env;

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
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          console.log(`[assistant] AppSync response ${opName || '(unknown)'} ${res.statusCode} in ${Date.now()-startedAt}ms`);
          try {
            const json = JSON.parse(data || '{}');
            resolve(json);
          } catch (e) {
            resolve({ errors: [{ message: 'Non-JSON response from AppSync' }], raw: data });
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
        items { id conversationId content senderId createdAt }
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

async function createAssistantMessage(conversationId, content, jwt) {
  const m = /* GraphQL */ `
    mutation CreateMessage($input: CreateMessageInput!) {
      createMessage(input: $input) { id conversationId content senderId messageType createdAt updatedAt }
    }
  `;
  const nowIso = new Date().toISOString();
  const input = { conversationId, content, senderId: ASSISTANT_BOT_USER_ID, messageType: 'TEXT', createdAt: nowIso, updatedAt: nowIso };
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

exports.handler = async (event) => {
  try {
    console.log('[assistant] handler invoked');
    console.log('[assistant] env region:', AWS_REGION, 'endpoint set:', !!APPSYNC_ENDPOINT);
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
    const { requestId, conversationId, userId, text, jwt } = body || {};
    console.log('[assistant] payload:', { requestId, conversationId, userId, textLen: (text||'').length, hasJwt: !!jwt });

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

    // Single tool: get recent messages
    let recent = [];
    try { recent = await getRecentMessages(conversationId, 10, jwt); } catch (e) { console.warn('[assistant] getRecentMessages failed:', e?.message || e); }
    const lastUserMessage = (recent || []).find((m) => m?.senderId === userId)?.content || text || '';
    const content = `${ASSISTANT_REPLY_PREFIX} I saw ‘${(lastUserMessage || '').slice(0, 200)}’. I’ll be smarter soon.`;

    try {
      const posted = await createAssistantMessage(conversationId, content, jwt);
      console.log('[assistant] reply posted id:', posted?.id || '(none)');
      // If backend ignored fields, patch them immediately
      if (posted && (!posted.messageType || !posted.updatedAt)) {
        await ensureMessageFields(posted.id, jwt).catch(() => {});
      }
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


