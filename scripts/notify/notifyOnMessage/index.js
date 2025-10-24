// Minimal Lambda to send push notifications via Expo Push API.
// If recipients are not provided, it looks them up from DynamoDB tables using conversationId/senderId.
const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';

const { DynamoDBClient, ScanCommand, BatchGetItemCommand } = require('@aws-sdk/client-dynamodb');
const ddb = new DynamoDBClient({});

const USERS_TABLE = process.env.USERS_TABLE;
const PARTICIPANTS_TABLE = process.env.PARTICIPANTS_TABLE;

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function getRecipientTokens(conversationId, senderId) {
  if (!USERS_TABLE || !PARTICIPANTS_TABLE) return [];
  // Scan participants table for items matching this conversationId (simple and robust for MVP)
  let lastKey = undefined;
  const participantUserIds = [];
  do {
    const cmd = new ScanCommand({
      TableName: PARTICIPANTS_TABLE,
      FilterExpression: '#cid = :cid',
      ExpressionAttributeNames: { '#cid': 'conversationId' },
      ExpressionAttributeValues: { ':cid': { S: conversationId } },
      ProjectionExpression: 'userId',
      ExclusiveStartKey: lastKey,
    });
    const res = await ddb.send(cmd).catch(() => null);
    if (!res) break;
    (res.Items || []).forEach(item => {
      const uid = item && item.userId && item.userId.S;
      if (uid && uid !== senderId) participantUserIds.push(uid);
    });
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  const uniqueIds = Array.from(new Set(participantUserIds));
  if (!uniqueIds.length) return [];

  const keys = uniqueIds.map(id => ({ id: { S: id } }));
  const batches = chunkArray(keys, 100);
  const tokens = [];
  for (const b of batches) {
    const cmd = new BatchGetItemCommand({
      RequestItems: {
        [USERS_TABLE]: {
          Keys: b,
          ProjectionExpression: '#id, pushToken',
          ExpressionAttributeNames: { '#id': 'id' },
        },
      },
    });
    const res = await ddb.send(cmd).catch(() => null);
    const items = (res && res.Responses && res.Responses[USERS_TABLE]) || [];
    for (const u of items) {
      const token = u && u.pushToken && u.pushToken.S;
      if (token) tokens.push(token);
    }
  }
  return Array.from(new Set(tokens));
}

exports.handler = async function handler(event) {
  try {
    const conversationId = event && event.conversationId;
    const senderId = event && event.senderId;
    let tokens = Array.isArray(event && event.recipients) ? event.recipients.filter(Boolean) : [];
    if ((!tokens || tokens.length === 0) && conversationId && senderId) {
      tokens = await getRecipientTokens(conversationId, senderId);
    }
    console.log('[notify] start', { conversationId, senderId, tokenCount: (tokens && tokens.length) || 0 });
    if (!conversationId || !senderId || !tokens || tokens.length === 0) {
      console.log('[notify] no recipients or missing params');
      return { ok: false, reason: 'missing-params-or-no-recipients', count: 0 };
    }
    const bodyText = (event && event.preview) ? String(event.preview) : 'New message';
    const messages = tokens.map(t => ({
      to: t,
      title: 'New message',
      body: bodyText,
      data: { conversationId },
      sound: null,
      priority: 'default',
    }));
    const batches = chunkArray(messages, 100);
    let sent = 0;
    for (const batch of batches) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.log('[notify] expo push error', { status: res.status, body: txt?.slice?.(0, 500) });
        throw new Error(`expo-push-failed ${res.status} ${txt}`);
      }
      sent += batch.length;
    }
    console.log('[notify] done', { sent });
    return { ok: true, sent };
  } catch (e) {
    try { console.log('[notify] exception', { message: e && e.message }); } catch {}
    return { ok: false, error: (e && e.message) || String(e) };
  }
};
