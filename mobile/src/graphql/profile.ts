import { generateClient } from 'aws-amplify/api';

let _client: any = null;
function getClient(): any {
  if (_client == null) {
    _client = generateClient();
  }
  return _client;
}

export async function updateUserProfile(input: { firstName?: string; lastName?: string; avatarColor?: string }) {
  const mutation = /* GraphQL */ `
    mutation UpdateUserProfile($input: UpdateUserProfileInput!) {
      updateUserProfile(input: $input) {
        userId
        firstName
        lastName
        email
        avatarColor
        updatedAt
      }
    }
  `;
  const r: any = await getClient().graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
  try {
    const p = r?.data?.updateUserProfile;
    if (p?.userId) profileCache.set(p.userId, { profile: p, expiresAt: Date.now() + 5 * 60 * 1000 });
  } catch {}
  return r;
}

export async function getUserProfile(userId: string) {
  const query = /* GraphQL */ `
    query GetUserProfile($userId: ID!) {
      getUserProfile(userId: $userId) {
        userId
        firstName
        lastName
        email
        avatarColor
        updatedAt
      }
    }
  `;
  return getClient().graphql({ query, variables: { userId }, authMode: 'userPool' });
}

// In-memory TTL cache for profiles
const profileCache = new Map<string, { profile: any; expiresAt: number }>();

export function invalidateProfileCache(userId?: string) {
  try {
    if (!userId) {
      profileCache.clear();
    } else {
      profileCache.delete(userId);
    }
  } catch {}
}

async function getProfileCached(userId: string, ttlMs = 5 * 60 * 1000): Promise<any | undefined> {
  const now = Date.now();
  const hit = profileCache.get(userId);
  if (hit && hit.expiresAt > now) return hit.profile;
  try {
    const r: any = await getUserProfile(userId);
    const p = r?.data?.getUserProfile;
    if (p) profileCache.set(userId, { profile: p, expiresAt: now + ttlMs });
    return p;
  } catch {
    return undefined;
  }
}

export async function batchGetProfilesCached(userIds: string[], ttlMs = 5 * 60 * 1000, concurrency = 4) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const results: Record<string, any> = {};
  const pending: string[] = [];
  const now = Date.now();
  for (const id of unique) {
    const hit = profileCache.get(id);
    if (hit && hit.expiresAt > now) {
      results[id] = hit.profile;
    } else {
      pending.push(id);
    }
  }
  let i = 0;
  async function worker() {
    while (i < pending.length) {
      const idx = i++;
      const id = pending[idx];
      const p = await getProfileCached(id, ttlMs);
      if (p) results[id] = p;
    }
  }
  const workers: Promise<void>[] = [];
  const limit = Math.max(1, concurrency);
  for (let k = 0; k < limit; k++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

export async function ensureProfileSeed(userId: string, defaults: { firstName?: string; lastName?: string; email?: string; avatarColor?: string }) {
  try {
    const existing = await getProfileCached(userId, 1000);
    if (existing && (existing.firstName || existing.lastName)) return existing;
  } catch {}
  try {
    const input: any = {};
    if (defaults.firstName) input.firstName = defaults.firstName;
    if (defaults.lastName) input.lastName = defaults.lastName;
    if (defaults.avatarColor) input.avatarColor = defaults.avatarColor;
    const r: any = await updateUserProfile(input);
    const p = r?.data?.updateUserProfile;
    if (p) profileCache.set(userId, { profile: p, expiresAt: Date.now() + 5 * 60 * 1000 });
    return p;
  } catch {
    return undefined;
  }
}
