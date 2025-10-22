import { generateClient } from 'aws-amplify/api';

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
