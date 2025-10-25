import { generateClient } from 'aws-amplify/api';
import { getFlags } from '../utils/flags';

// Lazily create the GraphQL client after Amplify has been configured
let _client: any = null;
function getClient(): any {
  if (_client == null) {
    _client = generateClient();
  }
  return _client;
}

function safe(obj: unknown) {
  try {
    return JSON.stringify(obj, Object.getOwnPropertyNames(obj as object));
  } catch {
    try { return JSON.stringify(obj); } catch { return String(obj); }
  }
}

let didLogQueryFields = false;
async function logQueryFieldsOnce() {
  if (didLogQueryFields) return;
  const { ENABLE_INTROSPECTION } = getFlags();
  if (!ENABLE_INTROSPECTION) return;
  didLogQueryFields = true;
  const introspect = /* GraphQL */ `
    query IntrospectQueryFields {
      __schema { queryType { fields { name } } }
    }
  `;
  try {
    const res: any = await getClient().graphql({ query: introspect, authMode: 'userPool' });
    const names = (res?.data?.__schema?.queryType?.fields || []).map((f: any) => f?.name).filter(Boolean);
  } catch (ie) {}
}

// Root schema alignment: use messagesByConversationIdAndCreatedAt, createMessage, and onCreateMessage with filter

export async function listMessagesByConversation(
  conversationId: string,
  limit = 25,
  nextToken?: string
) {
  const query = /* GraphQL */ `
    query MessagesByConversation($conversationId: String!, $limit: Int, $nextToken: String, $sortDirection: ModelSortDirection) {
      messagesByConversationIdAndCreatedAt(conversationId: $conversationId, limit: $limit, nextToken: $nextToken, sortDirection: $sortDirection) {
        items {
          id
          conversationId
          content
          attachments
          messageType
          senderId
          metadata
          editedAt
          createdAt
          updatedAt
        }
        nextToken
      }
    }
  `;
  return getClient().graphql({
    query,
    variables: { conversationId, limit, nextToken, sortDirection: 'DESC' },
    authMode: 'userPool',
  });
}

export async function getLatestMessageInConversation(conversationId: string) {
  const query = /* GraphQL */ `
    query LatestMessage($conversationId: String!, $limit: Int, $sortDirection: ModelSortDirection) {
      messagesByConversationIdAndCreatedAt(conversationId: $conversationId, limit: $limit, sortDirection: $sortDirection) {
        items { id createdAt content senderId metadata }
      }
    }
  `;
  const res: any = await getClient().graphql({ query, variables: { conversationId, limit: 1, sortDirection: 'DESC' }, authMode: 'userPool' });
  return res?.data?.messagesByConversationIdAndCreatedAt?.items?.[0] || null;
}

export async function getMessageById(id: string) {
  const query = /* GraphQL */ `
    query GetMessage($id: ID!) {
      getMessage(id: $id) { id metadata content messageType updatedAt }
    }
  `;
  const res: any = await getClient().graphql({ query, variables: { id }, authMode: 'userPool' });
  return res?.data?.getMessage || null;
}

// removed unused countMessagesAfter

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
        metadata
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
  return getClient().graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
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
        metadata
        createdAt
        updatedAt
      }
    }
  `;
  const variables = { conversationId } as const;
  const op = getClient().graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
  return op.subscribe.bind(op);
}

function subscribeMessagesViaOnCreate(conversationId: string) {
  const subscription = /* GraphQL */ `
    subscription OnCreateMessage($filter: ModelSubscriptionMessageFilterInput) {
      onCreateMessage(filter: $filter) {
        id
        conversationId
        content
        attachments
        messageType
        senderId
        metadata
        createdAt
        updatedAt
      }
    }
  `;
  const variables = { filter: { conversationId: { eq: conversationId } } } as const;
  const op = getClient().graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
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
    return await getClient().graphql({ query: create, variables: { input }, authMode: 'userPool' });
  } catch (e) {
    // Fallback to update if receipt exists; requires id, but Amplify resolvers usually allow composite update via additional keys
    // If backend enforces id, client should store receipt id; for MVP, attempt update without id may fail silently.
    const updateInput: any = { ...input };
    return getClient().graphql({ query: update, variables: { input: updateInput }, authMode: 'userPool' });
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

export function subscribeReceiptsForUser(userId: string) {
  const subscription = /* GraphQL */ `
    subscription OnCreateMessageRead($filter: ModelSubscriptionMessageReadFilterInput) {
      onCreateMessageRead(filter: $filter) { id messageId userId deliveredAt readAt createdAt updatedAt }
    }
  `;
  const variables = { filter: { userId: { eq: userId } } } as const;
  const op = getClient().graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
  return op.subscribe.bind(op);
}

export async function getReceiptForMessageUser(messageId: string, userId: string) {
  const query = /* GraphQL */ `
    query Receipt($messageId: String!, $userId: ModelStringKeyConditionInput, $limit: Int) {
      messageReadsByMessageIdAndUserId(messageId: $messageId, userId: $userId, limit: $limit) {
        items { id messageId userId deliveredAt readAt createdAt updatedAt }
      }
    }
  `;
  return getClient().graphql({ query, variables: { messageId, userId: { eq: userId }, limit: 1 }, authMode: 'userPool' });
}

// removed unused createImageMessage (image URL sending reuses sendTextMessageCompat)

export async function sendTyping(conversationId: string, userId: string) {
  const mutation = /* GraphQL */ `
    mutation SendTyping($conversationId: String!, $userId: String!) {
      sendTyping(conversationId: $conversationId, userId: $userId) { conversationId userId at }
    }
  `;
  return getClient().graphql({ query: mutation, variables: { conversationId, userId }, authMode: 'userPool' });
}

export function subscribeTyping(conversationId: string) {
  const subscription = /* GraphQL */ `
    subscription OnTypingInConversation($conversationId: String!) {
      onTypingInConversation(conversationId: $conversationId) { conversationId userId at }
    }
  `;
  const variables = { conversationId } as const;
  const op = getClient().graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
  return op.subscribe.bind(op);
}

// Compatibility layer: fallback to legacy VTL operations if root schema operations are unavailable

// Generic list using Model filter: listMessages(filter: { conversationId: { eq } })
async function listMessagesByFilter(
  conversationId: string,
  limit = 25,
  nextToken?: string
) {
  const query = /* GraphQL */ `
    query ListMessagesByFilter($conversationId: String!, $limit: Int, $nextToken: String) {
      listMessages(filter: { conversationId: { eq: $conversationId } }, limit: $limit, nextToken: $nextToken) {
        items {
          id
          conversationId
          content
          attachments
          messageType
          senderId
          metadata
          createdAt
          updatedAt
        }
        nextToken
      }
    }
  `;
  return getClient().graphql({
    query,
    variables: { conversationId, limit, nextToken },
    authMode: 'userPool',
  });
}

async function listMessagesVtl(
  conversationId: string,
  limit = 25,
  nextToken?: string
) {
  const query = /* GraphQL */ `
    query ListMessages($conversationId: ID!, $limit: Int, $nextToken: String) {
      listMessages(conversationId: $conversationId, limit: $limit, nextToken: $nextToken) {
        items { conversationId timestamp messageId senderId content status }
        nextToken
      }
    }
  `;
  return getClient().graphql({
    query,
    variables: { conversationId, limit, nextToken },
    authMode: 'userPool',
  });
}

async function sendMessageVtl(conversationId: string, content: string) {
  const mutation = /* GraphQL */ `
    mutation SendMessage($conversationId: ID!, $content: String!) {
      sendMessage(conversationId: $conversationId, content: $content) {
        id conversationId senderId content messageType createdAt updatedAt
      }
    }
  `;
  return getClient().graphql({ query: mutation, variables: { conversationId, content }, authMode: 'userPool' });
}

function subscribeMessagesVtl(conversationId: string) {
  const subscription = /* GraphQL */ `
    subscription OnMessage($conversationId: ID!) {
      onMessage(conversationId: $conversationId) {
        id conversationId senderId content messageType createdAt updatedAt
      }
    }
  `;
  const variables = { conversationId } as const;
  const op = getClient().graphql({ query: subscription, variables, authMode: 'userPool' }) as any;
  return op.subscribe.bind(op);
}

function mapVtlMessageToRootShape(v: any) {
  return {
    id: v.id,
    conversationId: v.conversationId,
    content: v.content,
    attachments: v.attachments,
    messageType: v.messageType ?? 'TEXT',
    senderId: v.senderId,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export async function listMessagesCompat(
  conversationId: string,
  limit = 25,
  nextToken?: string
) {
  try {
    const res: any = await listMessagesByConversation(conversationId, limit, nextToken);
    if (res?.errors?.length) {
      throw new Error(res.errors?.[0]?.message || 'root returned errors');
    }
    const page = res?.data?.messagesByConversationIdAndCreatedAt;
    if (!page || !page.items) throw new Error('root listMessages unavailable');
    return { items: page.items, nextToken: page.nextToken };
  } catch (e) {
    
    // Log what fields the backend actually exposes to guide fallback
    logQueryFieldsOnce().catch(() => {});
    // Try generic list with filter shape next
    try {
      const res: any = await listMessagesByFilter(conversationId, limit, nextToken);
      if (res?.errors?.length) {
      }
      const page = res?.data?.listMessages;
      const items = page?.items || [];
      return { items, nextToken: page?.nextToken };
    } catch (ge) {
      
    }
    // Finally try legacy VTL API shape if present
    try {
      const res: any = await listMessagesVtl(conversationId, limit, nextToken);
      if (res?.errors?.length) {
      }
      const page = res?.data?.listMessages;
      const items = (page?.items || []).map(mapVtlMessageToRootShape);
      return { items, nextToken: page?.nextToken };
    } catch (ve) {
      
      throw ve;
    }
  }
}

export async function sendTextMessageCompat(
  conversationId: string,
  content: string,
  senderId: string
) {
  try {
    const res: any = await createTextMessage(conversationId, content, senderId);
    const msg = res?.data?.createMessage;
    if (!msg) throw new Error('root send unavailable');
    return msg;
  } catch (e) {
    try {} catch {}
    // Do not attempt legacy VTL fallback; surface the root error to caller
    throw e;
  }
}

export function subscribeMessagesCompat(conversationId: string) {
  // Return a subscribe function that will attempt the root schema first, then fall back to VTL on error
  return (observer: any) => {
    let active: any = null;
    let fallbackActive: any = null;
    let onCreateActive: any = null;

    const startOnCreate = () => {
      if (onCreateActive) return;
      try {
        const oc = subscribeMessagesViaOnCreate(conversationId);
        onCreateActive = oc({
          next: (evt: any) => {
            const m = evt?.data?.onCreateMessage;
            if (!m) return;
            observer.next?.({ data: { onMessageInConversation: m } });
          },
          error: (err: any) => {
            // if onCreate fails too, try legacy VTL
            startFallback();
          },
        });
      } catch (e) {
        
        startFallback();
      }
    };

    const startFallback = () => {
      if (fallbackActive) return;
      const fallback = subscribeMessagesVtl(conversationId);
      fallbackActive = fallback({
        next: (evt: any) => {
          const mapped = mapVtlMessageToRootShape(evt.data.onMessage);
          observer.next?.({ data: { onMessageInConversation: mapped } });
        },
        error: (err: any) => {
          observer.error?.(err);
        },
      });
    };

    try {
      const primary = subscribeMessagesInConversation(conversationId);
      active = primary({
        next: (evt: any) => {
          try {} catch {}
          observer.next?.(evt);
        },
        error: (_err: any) => {
          try { active?.unsubscribe?.(); } catch {}
          startOnCreate();
        },
      });
    } catch {
      startOnCreate();
    }

    return {
      unsubscribe: () => {
        try { active?.unsubscribe?.(); } catch {}
        try { fallbackActive?.unsubscribe?.(); } catch {}
        try { onCreateActive?.unsubscribe?.(); } catch {}
      },
    };
  };
}
