import { generateClient } from 'aws-amplify/api';

const client = generateClient();

export async function listMessages(conversationId: string, limit = 25, nextToken?: string) {
  const query = /* GraphQL */ `
    query ListMessages($conversationId: ID!, $limit: Int, $nextToken: String) {
      listMessages(conversationId: $conversationId, limit: $limit, nextToken: $nextToken) {
        items { conversationId timestamp messageId senderId content status }
        nextToken
      }
    }
  `;
  return client.graphql({ query, variables: { conversationId, limit, nextToken }, authMode: 'userPool' });
}

export async function sendMessage(conversationId: string, content: string) {
  const mutation = /* GraphQL */ `
    mutation SendMessage($conversationId: ID!, $content: String!) {
      sendMessage(conversationId: $conversationId, content: $content) {
        conversationId timestamp messageId senderId content status
      }
    }
  `;
  return client.graphql({ query: mutation, variables: { conversationId, content }, authMode: 'userPool' });
}

export function subscribeMessages(conversationId: string) {
  const subscription = /* GraphQL */ `
    subscription OnMessage($conversationId: ID!) {
      onMessage(conversationId: $conversationId) {
        conversationId timestamp messageId senderId content status
      }
    }
  `;
  return client.graphql({ query: subscription, variables: { conversationId }, authMode: 'userPool' }).subscribe;
}
