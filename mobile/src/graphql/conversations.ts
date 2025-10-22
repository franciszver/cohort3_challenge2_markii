import { generateClient } from 'aws-amplify/api';

let _client: any = null;
function getClient(): any {
  if (_client == null) _client = generateClient();
  return _client;
}

export async function createConversation(name: string | undefined, isGroup: boolean, participantIds: string[]) {
  const createConv = /* GraphQL */ `
    mutation CreateConversation($input: CreateConversationInput!) {
      createConversation(input: $input) { id name isGroup createdBy createdAt }
    }
  `;
  const createParticipant = /* GraphQL */ `
    mutation CreateConversationParticipant($input: CreateConversationParticipantInput!) {
      createConversationParticipant(input: $input) { id conversationId userId role joinedAt }
    }
  `;
  const meId = participantIds[0];
  const convRes: any = await getClient().graphql({ query: createConv, variables: { input: { name, isGroup, createdBy: meId, participants: [] } }, authMode: 'userPool' });
  const conv = convRes?.data?.createConversation;
  if (!conv?.id) throw new Error('Conversation create failed');
  // Add participants (including creator)
  for (const uid of participantIds) {
    await getClient().graphql({ query: createParticipant, variables: { input: { conversationId: conv.id, userId: uid, joinedAt: new Date().toISOString(), role: uid === meId ? 'ADMIN' : 'MEMBER' } }, authMode: 'userPool' });
  }
  return conv;
}

export async function listConversationsForUser(userId: string, limit = 20, nextToken?: string) {
  const query = /* GraphQL */ `
    query ListMyConversations($userId: String!, $limit: Int, $nextToken: String) {
      conversationParticipantsByUserIdAndConversationId(userId: $userId, limit: $limit, nextToken: $nextToken) {
        items { conversationId userId role joinedAt lastReadAt }
        nextToken
      }
    }
  `;
  return getClient().graphql({ query, variables: { userId, limit, nextToken }, authMode: 'userPool' });
}

export async function getConversation(id: string) {
  const query = /* GraphQL */ `
    query GetConversation($id: ID!) { getConversation(id: $id) { id name isGroup createdBy createdAt updatedAt } }
  `;
  return getClient().graphql({ query, variables: { id }, authMode: 'userPool' });
}

export async function listParticipantsForConversation(conversationId: string, limit = 50, nextToken?: string) {
  const query = /* GraphQL */ `
    query Parts($conversationId: String!, $limit: Int, $nextToken: String) {
      conversationParticipantsByConversationIdAndUserId(conversationId: $conversationId, limit: $limit, nextToken: $nextToken) {
        items { userId role joinedAt lastReadAt }
        nextToken
      }
    }
  `;
  return getClient().graphql({ query, variables: { conversationId, limit, nextToken }, authMode: 'userPool' });
}

export async function updateParticipantLastRead(conversationId: string, userId: string, lastReadAtISO: string) {
  const mutation = /* GraphQL */ `
    mutation UpdateConversationParticipant($input: UpdateConversationParticipantInput!) {
      updateConversationParticipant(input: $input) { id conversationId userId lastReadAt updatedAt }
    }
  `;
  const input = { conversationId, id: undefined, userId, lastReadAt: lastReadAtISO } as any;
  return getClient().graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
}


