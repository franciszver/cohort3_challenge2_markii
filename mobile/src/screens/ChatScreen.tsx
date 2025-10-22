import React, { useEffect, useRef, useState } from 'react';
import { View, FlatList, TextInput, Button, Text, Image, TouchableOpacity, Modal } from 'react-native';
import { formatTimestamp } from '../utils/time';
import { listMessagesCompat, sendTextMessageCompat, subscribeMessagesCompat, markDelivered, markRead, sendTyping, subscribeTyping, getReceiptForMessageUser } from '../graphql/messages';
import { getCurrentUser } from 'aws-amplify/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatHeader from '../components/ChatHeader';
import { useIsFocused } from '@react-navigation/native';
import { updateLastSeen } from '../graphql/users';
import { updateParticipantLastRead } from '../graphql/conversations';

function conversationIdFor(a: string, b: string) {
  return [a, b].sort().join('#');
}

export default function ChatScreen({ route }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const subRef = useRef<any>(null);
  const typingSubRef = useRef<any>(null);
  const receiptsSubRef = useRef<any>(null);
  const typingTimerRef = useRef<any>(null);
  const lastTypingSentRef = useRef<number>(0);
  const [isTyping, setIsTyping] = useState(false);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const retryTimerRef = useRef<any>(null);
  const isFocused = useIsFocused();
  const otherUserId = route.params?.otherUserSub as string;
  const providedConversationId = route.params?.conversationId as string | undefined;
  const [infoVisible, setInfoVisible] = useState(false);
  const [infoText, setInfoText] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const me = await getCurrentUser();
        const cid = providedConversationId || conversationIdFor(me.userId, otherUserId);
        // hydrate from cache first
        const cached = await AsyncStorage.getItem(`history:${cid}`);
        if (cached) {
          try { setMessages(JSON.parse(cached)); } catch {}
        }
        // fetch latest page
        const res: any = await listMessagesCompat(cid, 25);
        const items = res.items;
        setNextToken(res.nextToken);
        // Decorate with basic status icon based on receipts for 1:1
        const decorated = await Promise.all(items.map(async (m: any) => {
          try {
            if (m.senderId === me.userId) {
              const r: any = await getReceiptForMessageUser(m.id, otherUserId);
              const receipt = r?.data?.messageReadsByMessageIdAndUserId?.items?.[0];
              const state = receipt?.readAt ? 'read' : (receipt?.deliveredAt ? 'delivered' : 'sent');
              return { ...m, __status: state };
            }
          } catch {}
          return m;
        }));
        setMessages(decorated);
        await AsyncStorage.setItem(`history:${cid}`, JSON.stringify(items));
        // mark delivered for fetched messages not sent by me
        try {
          for (const m of items) {
            if (m.senderId !== me.userId) {
              await markDelivered(m.id, me.userId);
            }
          }
        } catch {}
        // subscribe to new messages in this conversation
        const subscribe = subscribeMessagesCompat(cid);
        const sub = subscribe({
          next: async (evt: any) => {
            const m = evt.data.onMessageInConversation;
            // Opportunistic presence update on inbound activity
            try { const meNow = await getCurrentUser(); await updateLastSeen(meNow.userId); } catch {}
            setMessages(prev => {
              const next = [m, ...prev];
              AsyncStorage.setItem(`history:${cid}`, JSON.stringify(next)).catch(() => {});
              return next;
            });
            try { await markDelivered(m.id, me.userId); } catch {}
            if (m.senderId !== me.userId) {
              try { await markRead(m.id, me.userId); } catch {}
              // foreground local notification when chat not focused
              if (!isFocused) {
                try {
                  // @ts-ignore
                  const Notifications: any = await import('expo-notifications');
                  await Notifications.requestPermissionsAsync();
                  await Notifications.scheduleNotificationAsync({
                    content: { title: 'New message', body: m.content || 'New message received' },
                    trigger: null,
                  });
                } catch {}
              }
            }
          },
          error: (e: any) => console.log('sub error', e),
        });
        subRef.current = sub;
        // subscribe to typing events
        const typingSubscribe = subscribeTyping(cid);
        const typingSub = typingSubscribe({
          next: (evt: any) => {
            const ev = evt.data.onTypingInConversation;
            if (ev?.userId && ev.userId !== me.userId) {
              setIsTyping(true);
              if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
              typingTimerRef.current = setTimeout(() => setIsTyping(false), 2000);
            }
          },
          error: () => {},
        });
        typingSubRef.current = typingSub;
        // subscribe to receipts addressed to me (delivered/read)
        try {
          const { subscribeReceiptsForUser } = await import('../graphql/messages');
          const receiptsStart = subscribeReceiptsForUser(me.userId);
          const recSub = receiptsStart({ next: (_evt: any) => {
            // Receipts UI can be added later; mutation hooks already record reads/delivered
          }, error: () => {} });
          receiptsSubRef.current = recSub;
        } catch {}
        // drain outbox with retry/backoff
        const drainOnce = async () => {
          const outboxRaw = await AsyncStorage.getItem(`outbox:${cid}`);
          const outbox = outboxRaw ? JSON.parse(outboxRaw) : [];
          const remaining: any[] = [];
          for (const job of outbox) {
            const attempts = job.attempts || 0;
            try {
              if (job.type === 'image' && job.imageUrl) {
                await sendTextMessageCompat(cid, `[image] ${job.imageUrl}`, me.userId);
              } else if (job.content) {
                await sendTextMessageCompat(cid, job.content, me.userId);
              }
            } catch {
              job.attempts = attempts + 1;
              const delayMs = Math.min(30000, 1000 * Math.pow(2, attempts));
              job.nextTryAt = Date.now() + delayMs;
              remaining.push(job);
            }
          }
          if (remaining.length) {
            await AsyncStorage.setItem(`outbox:${cid}`, JSON.stringify(remaining));
          } else {
            await AsyncStorage.removeItem(`outbox:${cid}`);
          }
        };
        await drainOnce();
        // Set lastReadAt on entering chat
        try { await updateParticipantLastRead(cid, me.userId, new Date().toISOString()); } catch {}
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load chat');
      }
    })();
    return () => { subRef.current?.unsubscribe?.(); typingSubRef.current?.unsubscribe?.(); receiptsSubRef.current?.unsubscribe?.(); if (typingTimerRef.current) clearTimeout(typingTimerRef.current); };
  }, []);

  const onSend = async () => {
    try {
      setError(null);
      const me = await getCurrentUser();
      const cid = conversationIdFor(me.userId, otherUserId);
      const localId = `local-${Date.now()}`;
      const optimistic: any = {
        id: localId,
        conversationId: cid,
        createdAt: new Date().toISOString(),
        senderId: me.userId,
        content: input,
        messageType: 'TEXT',
        _localStatus: 'PENDING',
      };
      setMessages(prev => [optimistic, ...prev]);
      setInput('');
      try {
        const saved: any = await sendTextMessageCompat(cid, optimistic.content, me.userId);
        // Opportunistic presence update on outbound send
        try { await updateLastSeen(me.userId); } catch {}
        setMessages(prev => prev.map(m => (m.id === localId ? saved : m)));
      } catch (sendErr) {
        const key = `outbox:${cid}`;
        const raw = await AsyncStorage.getItem(key);
        const outbox = raw ? JSON.parse(raw) : [];
        outbox.push({ type: 'text', content: optimistic.content, createdAt: optimistic.createdAt });
        await AsyncStorage.setItem(key, JSON.stringify(outbox));
      }
      const snapshot = (prev => [optimistic, ...prev])(messages);
      AsyncStorage.setItem(`history:${cid}`, JSON.stringify(snapshot)).catch(() => {});
    } catch (e: any) {
      setError(e?.message ?? 'Send failed');
    }
  };

  const onSendImage = async () => {
    try {
      setError(null);
      const me = await getCurrentUser();
      const cid = conversationIdFor(me.userId, otherUserId);
      const url = imageUrl.trim();
      if (!url) return;
      const localId = `local-img-${Date.now()}`;
      const optimistic: any = {
        id: localId,
        conversationId: cid,
        createdAt: new Date().toISOString(),
        senderId: me.userId,
        content: `[image] ${url}`,
        attachments: [url],
        messageType: 'IMAGE',
        _localStatus: 'PENDING',
      };
      setMessages(prev => [optimistic, ...prev]);
      setImageUrl('');
      try {
        // For MVP, send the URL as content reference; uploading to S3 can be added later
        const saved: any = await sendTextMessageCompat(cid, optimistic.content, me.userId);
        setMessages(prev => prev.map(m => (m.id === localId ? saved : m)));
      } catch (sendErr) {
        const key = `outbox:${cid}`;
        const raw = await AsyncStorage.getItem(key);
        const outbox = raw ? JSON.parse(raw) : [];
        outbox.push({ type: 'image', imageUrl: url, createdAt: optimistic.createdAt });
        await AsyncStorage.setItem(key, JSON.stringify(outbox));
      }
      const snapshot = (prev => [optimistic, ...prev])(messages);
      AsyncStorage.setItem(`history:${cid}`, JSON.stringify(snapshot)).catch(() => {});
    } catch (e: any) {
      setError(e?.message ?? 'Send image failed');
    }
  };

  const onChangeInput = async (text: string) => {
    setInput(text);
    try {
      const now = Date.now();
      if (now - lastTypingSentRef.current > 1200) {
        lastTypingSentRef.current = now;
        const me = await getCurrentUser();
        const cid = conversationIdFor(me.userId, otherUserId);
        await sendTyping(cid, me.userId);
        // Opportunistic presence update on typing bursts (lightweight)
        try { await updateLastSeen(me.userId); } catch {}
      }
    } catch {}
  };

  return (
    <View style={{ flex: 1 }}>
      <ChatHeader username={otherUserId} online={undefined} subtitle={undefined} />
      {isTyping ? <Text style={{ paddingHorizontal: 12, color: '#6b7280' }}>typing…</Text> : null}
      <FlatList
        inverted
        data={messages}
        keyExtractor={(item: any) => item.id}
        onEndReachedThreshold={0.3}
        onScrollEndDrag={async () => {
          try { const me = await getCurrentUser(); const cidNow = providedConversationId || conversationIdFor(me.userId, otherUserId); await updateParticipantLastRead(cidNow, me.userId, new Date().toISOString()); } catch {}
        }}
        onEndReached={async () => {
          if (isLoadingMore || !nextToken) return;
          try {
            setIsLoadingMore(true);
            const me = await getCurrentUser();
            const cid = providedConversationId || conversationIdFor(me.userId, otherUserId);
            const cidMore = providedConversationId || conversationIdFor(me.userId, otherUserId);
      const page: any = await listMessagesCompat(cidMore, 25, nextToken);
      const older = page.items || [];
      setNextToken(page.nextToken);
            setMessages(prev => {
              const next = [...prev, ...older];
              AsyncStorage.setItem(`history:${cid}`, JSON.stringify(next)).catch(() => {});
              return next;
            });
          } catch {}
          finally { setIsLoadingMore(false); }
        }}
        renderItem={({ item }: any) => (
          <View style={{ padding: 8 }}>
            {item.messageType === 'IMAGE' && item.attachments?.[0] ? (
              <Image source={{ uri: item.attachments[0] }} style={{ width: 200, height: 200, borderRadius: 8 }} />
            ) : (
              <TouchableOpacity onLongPress={async () => {
                try {
                  if (otherUserId && item.senderId) {
                    const me = await getCurrentUser();
                    if (item.senderId === me.userId) {
                      const r: any = await getReceiptForMessageUser(item.id, otherUserId);
                      const rec = r?.data?.messageReadsByMessageIdAndUserId?.items?.[0];
                      const lines = [
                        `Delivered: ${rec?.deliveredAt ? new Date(rec.deliveredAt).toLocaleString() : '—'}`,
                        `Read: ${rec?.readAt ? new Date(rec.readAt).toLocaleString() : '—'}`,
                      ];
                      setInfoText(lines.join('\n'));
                      setInfoVisible(true);
                    } else {
                      setInfoText('Message info available for your sent messages.');
                      setInfoVisible(true);
                    }
                  }
                } catch {
                  setInfoText('Unable to load message info.');
                  setInfoVisible(true);
                }
              }}>
                <Text>
                  {item.senderId === 'me' ? 'Me' : item.senderId}: {item.content} {item._localStatus ? `(${item._localStatus})` : ''}
                  {item.__status ? ' ' : ''}
                  {item.__status === 'sent' ? '✓' : null}
                  {item.__status === 'delivered' ? <Text style={{ color: '#6b7280' }}>✓✓</Text> : null}
                  {item.__status === 'read' ? <Text style={{ color: '#3b82f6' }}>✓✓</Text> : null}
                </Text>
                <Text style={{ color: '#6b7280', fontSize: 12 }}>
                  {formatTimestamp(item.createdAt)}{item.editedAt ? ' · edited' : ''}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />
      <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 8, width: '80%' }}>
            <Text style={{ fontWeight: '600', marginBottom: 8 }}>Message info</Text>
            <Text style={{ color: '#111827', marginBottom: 12 }}>{infoText}</Text>
            <Button title="Close" onPress={() => setInfoVisible(false)} />
          </View>
        </View>
      </Modal>
      {error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', padding: 8, gap: 8 }}>
        <TextInput style={{ flex: 1, borderWidth: 1, padding: 8 }} value={input} onChangeText={onChangeInput} placeholder="Message" />
        <Button title="Send" onPress={onSend} />
      </View>
      <View style={{ flexDirection: 'row', padding: 8, gap: 8 }}>
        <TextInput style={{ flex: 1, borderWidth: 1, padding: 8 }} value={imageUrl} onChangeText={setImageUrl} placeholder="Image URL" autoCapitalize="none" />
        <Button title="Send Image" onPress={onSendImage} />
      </View>
    </View>
  );
}
