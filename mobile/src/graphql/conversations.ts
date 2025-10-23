import { generateClient } from 'aws-amplify/api';

let _client: any = null;
function getClient(): any {
  if (_client == null) _client = generateClient();
  return _client;
}

export async function createConversation(name: string | undefined, isGroup: boolean, participantIds: string[], id?: string) {
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
  const input: any = { name, isGroup, createdBy: meId };
  if (id) input.id = id;
  const convRes: any = await getClient().graphql({ query: createConv, variables: { input }, authMode: 'userPool' });
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

export async function getMyParticipantRecord(conversationId: string, userId: string) {
  const query = /* GraphQL */ `
    query MyPart($conversationId: String!, $userId: ModelStringKeyConditionInput, $limit: Int) {
      conversationParticipantsByConversationIdAndUserId(conversationId: $conversationId, userId: $userId, limit: $limit) {
        items { id conversationId userId lastReadAt }
      }
    }
  `;
  const res: any = await getClient().graphql({ query, variables: { conversationId, userId: { eq: userId }, limit: 1 }, authMode: 'userPool' });
  return res?.data?.conversationParticipantsByConversationIdAndUserId?.items?.[0] || null;
}

export async function updateParticipantLastReadById(participantId: string, lastReadAtISO: string) {
  const mutation = /* GraphQL */ `
    mutation UpdateConversationParticipant($input: UpdateConversationParticipantInput!) {
      updateConversationParticipant(input: $input) { id lastReadAt updatedAt }
    }
  `;
  const input = { id: participantId, lastReadAt: lastReadAtISO } as any;
  return getClient().graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
}

export async function setMyLastRead(conversationId: string, userId: string, lastReadAtISO: string) {
  const part = await getMyParticipantRecord(conversationId, userId);
  if (part?.id) {
    return updateParticipantLastReadById(part.id, lastReadAtISO);
  }
  return null;
}

export async function ensureDirectConversation(conversationId: string, meId: string, otherUserId: string) {
  // Try get; if missing, create with explicit id and two participants
  try {
    const existing: any = await getConversation(conversationId);
    if (existing?.data?.getConversation?.id) return existing.data.getConversation;
  } catch {}
  try {
    return await createConversation(undefined, false, [meId, otherUserId], conversationId);
  } catch (e) {
    // If creation races, fetch again
    const fallback: any = await getConversation(conversationId);
    return fallback?.data?.getConversation;
  }
}

export async function deleteConversationById(id: string, _version?: number) {
  const mutation = /* GraphQL */ `
    mutation DeleteConversation($input: DeleteConversationInput!) {
      deleteConversation(input: $input) { id }
    }
  `;
  const input: any = { id };
  if (_version != null) input._version = _version;
  return getClient().graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
}

export function subscribeConversationDeleted(conversationId: string) {
  const subscription = /* GraphQL */ `
    subscription OnDeleteConversation($filter: ModelSubscriptionConversationFilterInput) {
      onDeleteConversation(filter: $filter) { id }
    }
  `;
  const variables = { filter: { id: { eq: conversationId } } } as const;
  const op = getClient().graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
  return op.subscribe.bind(op);
}


