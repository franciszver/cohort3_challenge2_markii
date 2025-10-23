import { generateClient } from 'aws-amplify/api';
import { getFlags } from '../utils/flags';

let _client: any = null;
function getClient(): any {
  if (_client == null) {
    _client = generateClient();
  }
  return _client;
}

export async function updateLastSeen(userId: string, lastSeenISO?: string) {
  const mutation = /* GraphQL */ `
    mutation UpdateUser($input: UpdateUserInput!) {
      updateUser(input: $input) { id lastSeen updatedAt }
    }
  `;
  const input = {
    id: userId,
    lastSeen: lastSeenISO ?? new Date().toISOString(),
  } as const;
  return getClient().graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
}

export function subscribeUserPresence(userId: string) {
  const subscription = /* GraphQL */ `
    subscription OnUpdateUser($filter: ModelSubscriptionUserFilterInput) {
      onUpdateUser(filter: $filter) { id lastSeen status updatedAt }
    }
  `;
  const variables = { filter: { id: { eq: userId } } } as const;
  const op = getClient().graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
  return op.subscribe.bind(op);
}

export async function getUserById(userId: string) {
  const query = /* GraphQL */ `
    query GetUser($id: ID!) {
      getUser(id: $id) { id email username displayName lastSeen status avatar updatedAt }
    }
  `;
  return getClient().graphql({ query, variables: { id: userId }, authMode: 'userPool' });
}

export async function batchGetUsers(userIds: string[]) {
  // Simple batched fetch; for Amplify GraphQL, issue queries sequentially to keep it simple for MVP
  const results: Record<string, any> = {};
  for (const uid of userIds) {
    try {
      const r: any = await getUserById(uid);
      const u = r?.data?.getUser;
      if (u) results[uid] = u;
    } catch {}
  }
  return results;
}

export async function lookupUserIdByEmail(email: string) {
  const query = /* GraphQL */ `
    query LookupByEmail($emailLower: String!, $limit: Int) {
      lookupByEmail(emailLower: $emailLower, limit: $limit) {
        items { id email username }
      }
    }
  `;
  const emailLower = email.toLowerCase().trim();
  return getClient().graphql({ query, variables: { emailLower, limit: 1 }, authMode: 'userPool' });
}

export async function lookupUserIdByUsername(username: string) {
  const query = /* GraphQL */ `
    query LookupUserIdByUsername($username: String!) {
      lookupUserIdByUsername(username: $username) {
        items { id }
      }
    }
  `;
  return getClient().graphql({ query, variables: { username }, authMode: 'userPool' });
}

// In-memory TTL cache and concurrency-limited batch lookup for list rendering
const userCache = new Map<string, { user: any; expiresAt: number }>();

async function getUserCached(uid: string, ttlMs = 5 * 60 * 1000): Promise<any | undefined> {
  const now = Date.now();
  const hit = userCache.get(uid);
  if (hit && hit.expiresAt > now) return hit.user;
  try {
    const r: any = await getUserById(uid);
    const u = r?.data?.getUser;
    if (u) userCache.set(uid, { user: u, expiresAt: now + ttlMs });
    return u;
  } catch {
    return undefined;
  }
}

export async function batchGetUsersCached(userIds: string[], ttlMs = 5 * 60 * 1000, concurrency = 4) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const results: Record<string, any> = {};
  const pending: string[] = [];
  const now = Date.now();
  for (const id of unique) {
    const hit = userCache.get(id);
    if (hit && hit.expiresAt > now) {
      results[id] = hit.user;
    } else {
      pending.push(id);
    }
  }
  let i = 0;
  async function worker() {
    while (i < pending.length) {
      const idx = i++;
      const id = pending[idx];
      const u = await getUserCached(id, ttlMs);
      if (u) results[id] = u;
    }
  }
  const p: Promise<void>[] = [];
  const limit = Math.max(1, concurrency);
  for (let k = 0; k < limit; k++) p.push(worker());
  await Promise.all(p);
  return results;
}
