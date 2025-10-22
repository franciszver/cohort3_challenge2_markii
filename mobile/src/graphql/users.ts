import { generateClient } from 'aws-amplify/api';

const client = generateClient();

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
  return client.graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
}

export function subscribeUserPresence(userId: string) {
  const subscription = /* GraphQL */ `
    subscription OnUpdateUser($filter: ModelSubscriptionUserFilterInput) {
      onUpdateUser(filter: $filter) { id lastSeen status updatedAt }
    }
  `;
  const variables = { filter: { id: { eq: userId } } } as const;
  const op = client.graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
  return op.subscribe.bind(op);
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
  return client.graphql({ query, variables: { emailLower, limit: 1 }, authMode: 'userPool' });
}

export async function lookupUserIdByUsername(username: string) {
  const query = /* GraphQL */ `
    query LookupUserIdByUsername($username: String!) {
      lookupUserIdByUsername(username: $username) {
        items { id }
      }
    }
  `;
  return client.graphql({ query, variables: { username }, authMode: 'userPool' });
}
