import { generateClient } from 'aws-amplify/api';

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
  didLogQueryFields = true;
  const introspect = /* GraphQL */ `
    query IntrospectQueryFields {
      __schema { queryType { fields { name } } }
    }
  `;
  try {
    const res: any = await getClient().graphql({ query: introspect, authMode: 'userPool' });
    const names = (res?.data?.__schema?.queryType?.fields || []).map((f: any) => f?.name).filter(Boolean);
    console.log('[messages] schema Query fields', names);
  } catch (ie) {
    console.log('[messages] schema introspection failed', { message: (ie as any)?.message, raw: safe(ie) });
  }
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
        items { id createdAt content senderId }
      }
    }
  `;
  const res: any = await getClient().graphql({ query, variables: { conversationId, limit: 1, sortDirection: 'DESC' }, authMode: 'userPool' });
  return res?.data?.messagesByConversationIdAndCreatedAt?.items?.[0] || null;
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
    console.log('[messages] listMessagesCompat root start', { conversationId, limit, nextToken });
    const res: any = await listMessagesByConversation(conversationId, limit, nextToken);
    if (res?.errors?.length) {
      console.log('[messages] listMessagesCompat root GraphQL errors', safe(res.errors));
      throw new Error(res.errors?.[0]?.message || 'root returned errors');
    }
    const page = res?.data?.messagesByConversationIdAndCreatedAt;
    if (!page || !page.items) throw new Error('root listMessages unavailable');
    console.log('[messages] listMessagesCompat root ok', { count: page.items.length, nextToken: page.nextToken });
    return { items: page.items, nextToken: page.nextToken };
  } catch (e) {
    console.log('[messages] listMessagesCompat root failed, trying VTL', {
      name: (e as any)?.name,
      code: (e as any)?.code,
      message: (e as any)?.message,
      errors: (e as any)?.errors,
      cause: (e as any)?.cause,
      raw: safe(e),
    });
    // Log what fields the backend actually exposes to guide fallback
    logQueryFieldsOnce().catch(() => {});
    // Try generic list with filter shape next
    try {
      const res: any = await listMessagesByFilter(conversationId, limit, nextToken);
      if (res?.errors?.length) {
        console.log('[messages] listMessagesCompat generic filter GraphQL errors', safe(res.errors));
      }
      const page = res?.data?.listMessages;
      const items = page?.items || [];
      console.log('[messages] listMessagesCompat generic filter ok', { count: items.length, nextToken: page?.nextToken });
      return { items, nextToken: page?.nextToken };
    } catch (ge) {
      console.log('[messages] listMessagesCompat generic filter failed, trying VTL', {
        name: (ge as any)?.name,
        code: (ge as any)?.code,
        message: (ge as any)?.message,
        errors: (ge as any)?.errors,
        cause: (ge as any)?.cause,
        raw: safe(ge),
      });
    }
    // Finally try legacy VTL API shape if present
    try {
      const res: any = await listMessagesVtl(conversationId, limit, nextToken);
      if (res?.errors?.length) {
        console.log('[messages] listMessagesCompat VTL GraphQL errors', safe(res.errors));
      }
      const page = res?.data?.listMessages;
      const items = (page?.items || []).map(mapVtlMessageToRootShape);
      console.log('[messages] listMessagesCompat VTL ok', { count: items.length, nextToken: page?.nextToken });
      return { items, nextToken: page?.nextToken };
    } catch (ve) {
      console.log('[messages] listMessagesCompat VTL failed', {
        name: (ve as any)?.name,
        code: (ve as any)?.code,
        message: (ve as any)?.message,
        errors: (ve as any)?.errors,
        cause: (ve as any)?.cause,
        raw: safe(ve),
      });
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
    console.log('[messages] sendTextMessageCompat root start', { conversationId, contentLen: content?.length ?? 0 });
    const res: any = await createTextMessage(conversationId, content, senderId);
    const msg = res?.data?.createMessage;
    if (!msg) throw new Error('root send unavailable');
    console.log('[messages] sendTextMessageCompat root ok', { id: msg?.id });
    return msg;
  } catch (e) {
    console.log('[messages] sendTextMessageCompat root failed, trying VTL', { message: (e as any)?.message });
    const res: any = await sendMessageVtl(conversationId, content);
    const mapped = mapVtlMessageToRootShape(res?.data?.sendMessage || {});
    console.log('[messages] sendTextMessageCompat VTL ok', { id: mapped?.id });
    return mapped;
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
            console.log('[messages] subscribe onCreate error', { message: err?.message });
            // if onCreate fails too, try legacy VTL
            startFallback();
          },
        });
      } catch (e) {
        console.log('[messages] subscribe onCreate threw; trying VTL');
        startFallback();
      }
    };

    const startFallback = () => {
      if (fallbackActive) return;
      const fallback = subscribeMessagesVtl(conversationId);
      fallbackActive = fallback({
        next: (evt: any) => {
          const mapped = mapVtlMessageToRootShape(evt.data.onMessage);
          console.log('[messages] subscribe VTL event', { id: mapped?.id });
          observer.next?.({ data: { onMessageInConversation: mapped } });
        },
        error: (err: any) => {
          console.log('[messages] subscribe VTL error', { message: err?.message });
          observer.error?.(err);
        },
      });
    };

    try {
      const primary = subscribeMessagesInConversation(conversationId);
      active = primary({
        next: (evt: any) => {
          try { console.log('[messages] subscribe root event', { id: evt?.data?.onMessageInConversation?.id }); } catch {}
          observer.next?.(evt);
        },
        error: (_err: any) => {
          try { active?.unsubscribe?.(); } catch {}
          console.log('[messages] subscribe root error; switching to onCreate');
          startOnCreate();
        },
      });
    } catch {
      console.log('[messages] subscribe root threw; starting onCreate');
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
