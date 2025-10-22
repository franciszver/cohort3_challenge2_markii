import { generateClient } from 'aws-amplify/api';

const client = generateClient();

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
