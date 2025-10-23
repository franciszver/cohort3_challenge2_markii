import { generateClient } from 'aws-amplify/api';

let _client: any = null;
function getClient(): any {
  if (_client == null) {
    _client = generateClient();
  }
  return _client;
}

export async function updateUserProfile(input: { username?: string; avatar?: string; status?: string }) {
  const mutation = /* GraphQL */ `
    mutation UpdateUserProfile($input: UpdateUserProfileInput!) {
      updateUserProfile(input: $input) {
        userId
        username
        avatar
        status
        updatedAt
      }
    }
  `;
  return getClient().graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
}

export async function getUserProfile(userId: string) {
  const query = /* GraphQL */ `
    query GetUserProfile($userId: ID!) {
      getUserProfile(userId: $userId) {
        userId
        username
        avatar
        status
        updatedAt
      }
    }
  `;
  return getClient().graphql({ query, variables: { userId }, authMode: 'userPool' });
}
