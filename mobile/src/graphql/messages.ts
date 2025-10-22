import { generateClient } from 'aws-amplify/api';

const client = generateClient();

// Root schema alignment: use messagesByConversationIdAndCreatedAt, createMessage, and onCreateMessage with filter

export async function listMessagesByConversation(
  conversationId: string,
  limit = 25,
  nextToken?: string
) {
  const query = /* GraphQL */ `
    query MessagesByConversation($conversationId: String!, $limit: Int, $nextToken: String, $sortDirection: ModelSortDirection) {
      messagesByConversationIdAndCreatedAt(conversationId: $conversationId, createdAt: { }, limit: $limit, nextToken: $nextToken, sortDirection: $sortDirection) {
        items {
          id
          conversationId
          content
          attachments
          messageType
          senderId
          createdAt
          updatedAt
        }
        nextToken
        startedAt
      }
    }
  `;
  return client.graphql({
    query,
    variables: { conversationId, limit, nextToken, sortDirection: 'DESC' },
    authMode: 'userPool',
  });
}

export async function createTextMessage(
  conversationId: string,
  content: string,
  senderId: string
) {
  const mutation = /* GraphQL */ `
    mutation CreateMessage($input: CreateMessageInput!) {
      createMessage(input: $input) {
        id
        conversationId
        content
        attachments
        messageType
        senderId
        createdAt
        updatedAt
      }
    }
  `;
  const input = {
    conversationId,
    content,
    senderId,
    messageType: 'TEXT',
    createdAt: new Date().toISOString(),
  } as const;
  return client.graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
}

export function subscribeMessagesInConversation(conversationId: string) {
  const subscription = /* GraphQL */ `
    subscription OnMessageInConversation($conversationId: String!) {
      onMessageInConversation(conversationId: $conversationId) {
        id
        conversationId
        content
        attachments
        messageType
        senderId
        createdAt
        updatedAt
      }
    }
  `;
  const variables = { conversationId } as const;
  const op = client.graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
  return op.subscribe.bind(op);
}

export async function createMessageRead(messageId: string, userId: string, readAtISO?: string, deliveredAtISO?: string) {
  const create = /* GraphQL */ `
    mutation CreateMessageRead($input: CreateMessageReadInput!) {
      createMessageRead(input: $input) {
        id
        messageId
        userId
        deliveredAt
        readAt
        createdAt
        updatedAt
      }
    }
  `;
  const update = /* GraphQL */ `
    mutation UpdateMessageRead($input: UpdateMessageReadInput!) {
      updateMessageRead(input: $input) {
        id
        messageId
        userId
        deliveredAt
        readAt
        updatedAt
      }
    }
  `;
  const input: any = {
    messageId,
    userId,
  };
  if (readAtISO) input.readAt = readAtISO;
  if (deliveredAtISO) input.deliveredAt = deliveredAtISO;
  try {
    return await client.graphql({ query: create, variables: { input }, authMode: 'userPool' });
  } catch (e) {
    // Fallback to update if receipt exists; requires id, but Amplify resolvers usually allow composite update via additional keys
    // If backend enforces id, client should store receipt id; for MVP, attempt update without id may fail silently.
    const updateInput: any = { ...input };
    return client.graphql({ query: update, variables: { input: updateInput }, authMode: 'userPool' });
  }
}

export async function markDelivered(messageId: string, userId: string) {
  const now = new Date().toISOString();
  return createMessageRead(messageId, userId, undefined, now);
}

export async function markRead(messageId: string, userId: string) {
  const now = new Date().toISOString();
  return createMessageRead(messageId, userId, now);
}

export async function createImageMessage(
  conversationId: string,
  imageUrl: string,
  senderId: string
) {
  const mutation = /* GraphQL */ `
    mutation CreateMessage($input: CreateMessageInput!) {
      createMessage(input: $input) {
        id
        conversationId
        content
        attachments
        messageType
        senderId
        createdAt
        updatedAt
      }
    }
  `;
  const input = {
    conversationId,
    content: '',
    senderId,
    messageType: 'IMAGE',
    attachments: [imageUrl],
    createdAt: new Date().toISOString(),
  } as const;
  return client.graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
}

export async function sendTyping(conversationId: string, userId: string) {
  const mutation = /* GraphQL */ `
    mutation SendTyping($conversationId: String!, $userId: String!) {
      sendTyping(conversationId: $conversationId, userId: $userId) { conversationId userId at }
    }
  `;
  return client.graphql({ query: mutation, variables: { conversationId, userId }, authMode: 'userPool' });
}

export function subscribeTyping(conversationId: string) {
  const subscription = /* GraphQL */ `
    subscription OnTypingInConversation($conversationId: String!) {
      onTypingInConversation(conversationId: $conversationId) { conversationId userId at }
    }
  `;
  const variables = { conversationId } as const;
  const op = client.graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
  return op.subscribe.bind(op);
}
