import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Button, FlatList, TouchableOpacity, Modal, TextInput } from 'react-native';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { listConversationsForUser, getConversation, listParticipantsForConversation, ensureDirectConversation } from '../graphql/conversations';
import { batchGetUsersCached } from '../graphql/users';
import { getLatestMessageInConversation } from '../graphql/messages';
import { formatTimestamp } from '../utils/time';
import { useFocusEffect } from '@react-navigation/native';
import { generateClient } from 'aws-amplify/api';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getFlags } from '../utils/flags';
import { subscribeToasts } from '../utils/toast';

export default function ConversationListScreen({ navigation }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showId, setShowId] = useState(false);
  const [myId, setMyId] = useState<string>('');
  const [showSolo, setShowSolo] = useState(false);
  const [soloOtherId, setSoloOtherId] = useState('');
  const [soloBusy, setSoloBusy] = useState(false);
  const [banner, setBanner] = useState<{ conversationId: string; preview: string } | null>(null);
  const notifySubsRef = useRef<any[]>([]);
  const lastNotifyAtRef = useRef<Record<string, number>>({});
  const toastUnsubRef = useRef<null | (() => void)>(null);

  const isLoadingRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const load = useCallback(async () => {
    try {
      if (isLoadingRef.current) return;
      const now = Date.now();
      if (now - lastLoadedAtRef.current < 1500) return; // staleness guard
      isLoadingRef.current = true;
      setError(null);
      const me = await getCurrentUser();
      setMyId(me.userId);
      // Header actions
      navigation.setOptions({
        headerRight: () => (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="My ID" onPress={() => setShowId(true)} />
            <Button title="Solo" onPress={() => setShowSolo(true)} />
            <Button title="Sign Out" onPress={async () => { try { await signOut(); } catch {} navigation.replace('Auth'); }} />
          </View>
        ),
      });
      // Fetch ALL conversations (paginate) and capture my lastReadAt per conversation
      const convIdsSet = new Set<string>();
      const myLastRead: Record<string, string | undefined> = {};
      let next: string | undefined = undefined;
      do {
        const res: any = await listConversationsForUser(me.userId, 50, next);
        const parts = res?.data?.conversationParticipantsByUserIdAndConversationId;
        (parts?.items || []).forEach((p: any) => {
          if (p?.conversationId) convIdsSet.add(p.conversationId);
          if (p?.conversationId) myLastRead[p.conversationId] = p?.lastReadAt;
        });
        next = parts?.nextToken || undefined;
      } while (next);
      // Fallback: also scan conversations by participants array containing me
      try {
        const resList: any = await listConversationsByParticipant(me.userId, 50);
        const items = resList?.data?.listConversations?.items || [];
        items.forEach((c: any) => { if (c?.id) convIdsSet.add(c.id); });
      } catch {}
      const convIds = Array.from(convIdsSet);
      const convs: any[] = [];
      // Set up foreground notifications for new messages in these conversations
      try {
        // Clear previous subs
        notifySubsRef.current.forEach(s => { try { s?.unsubscribe?.(); } catch {} });
        notifySubsRef.current = [];
        // Configure notification handler/channel (idempotent)
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
            // align with newer NotificationBehavior fields
            shouldShowBanner: true,
            shouldShowList: true,
          } as any),
        });
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.HIGH });
        }
        const client: any = generateClient();
        const subGql = /* GraphQL */ `
          subscription OnCreateMessage($filter: ModelSubscriptionMessageFilterInput) {
            onCreateMessage(filter: $filter) { id conversationId content senderId createdAt }
          }
        `;
        // Global notification rate limit
        const { NOTIFY_RATE_LIMIT_PER_MINUTE } = getFlags();
        const windowMs = 60 * 1000;
        const sentTimes: number[] = [];
        function canSendNow() {
          const cutoff = Date.now() - windowMs;
          while (sentTimes.length && sentTimes[0] < cutoff) sentTimes.shift();
          return sentTimes.length < NOTIFY_RATE_LIMIT_PER_MINUTE;
        }

        for (const id of convIds) {
          const op = client.graphql({ query: subGql, variables: { filter: { conversationId: { eq: id } } }, authMode: 'userPool' }) as any;
          const sub = op.subscribe({
            next: async (evt: any) => {
              const m = evt?.data?.onCreateMessage;
              if (!m) return;
              // Update row preview immediately
              setItems(prev => {
                let touched = false;
                const next = prev.map((c: any) => {
                  if (c.id === id) {
                    touched = true;
                    const unread = m.senderId === myId ? (c._unread || 0) : 1;
                    return { ...c, _latest: { ...m }, _unread: unread };
                  }
                  return c;
                });
                if (!touched) return prev;
                // Re-sort by latest createdAt
                next.sort((a: any, b: any) => {
                  const at = a?._latest?.createdAt ? new Date(a._latest.createdAt).getTime() : 0;
                  const bt = b?._latest?.createdAt ? new Date(b._latest.createdAt).getTime() : 0;
                  return bt - at;
                });
                return next;
              });

              // Throttle foreground notification per conversation
              const now = Date.now();
              const last = lastNotifyAtRef.current[id] || 0;
              if (now - last < 1500) return;
              lastNotifyAtRef.current[id] = now;
              if (!canSendNow()) return;
              sentTimes.push(now);
              try {
                await Notifications.scheduleNotificationAsync({
                  content: { title: 'New message', body: m.content || 'New message received' },
                  trigger: null,
                });
              } catch {}
              // In-app banner
              setBanner({ conversationId: id, preview: m.content || 'New message' });
              setTimeout(() => {
                setBanner(curr => (curr && curr.conversationId === id ? null : curr));
              }, 4000);
            },
            error: () => {},
          });
          notifySubsRef.current.push(sub);
        }
      } catch {}
      for (const id of convIds) {
        const r: any = await getConversation(id);
        if (r?.data?.getConversation) {
          const c = r.data.getConversation;
          // Ensure my participant record exists (self-heal missing participant rows)
          try { await ensureParticipant(c.id, me.userId, 'MEMBER'); } catch {}
          // latest message preview
          const latest = await getLatestMessageInConversation(c.id);
          // Override with local cache if it has a newer message (V2 writes)
          let latestLocal: any = null;
          try {
            const cached = await AsyncStorage.getItem(`history:${c.id}`);
            if (cached) {
              const arr = JSON.parse(cached);
              if (Array.isArray(arr) && arr[0]) {
                latestLocal = arr[0];
              }
            }
          } catch {}
          const latestFinal = (() => {
            try {
              const lt = latest?.createdAt ? new Date(latest.createdAt).getTime() : 0;
              const lc = latestLocal?.createdAt ? new Date(latestLocal.createdAt).getTime() : 0;
              return lc > lt ? latestLocal : latest;
            } catch { return latest || latestLocal; }
          })();
          // fetch participant subset (first 3 for avatars)
          const partsRes: any = await listParticipantsForConversation(c.id, 3);
          const parts = partsRes?.data?.conversationParticipantsByConversationIdAndUserId?.items || [];
          const userMap = await batchGetUsersCached(parts.map((p: any) => p.userId));
          // compute unread from myLastRead map
          let unread = 0;
          const lastRead = myLastRead[c.id];
          if (latest?.createdAt && lastRead) {
            unread = new Date(latest.createdAt).getTime() > new Date(lastRead).getTime() ? 1 : 0;
          } else if (latest?.createdAt && !lastRead) {
            unread = 1;
          }
          convs.push({ ...c, _latest: latestFinal, _participants: parts, _users: userMap, _unread: unread });
        }
      }
      // Sort by latest activity (latest message createdAt desc)
      convs.sort((a: any, b: any) => {
        const at = a?._latest?.createdAt ? new Date(a._latest.createdAt).getTime() : 0;
        const bt = b?._latest?.createdAt ? new Date(b._latest.createdAt).getTime() : 0;
        return bt - at;
      });
      setItems(convs);
      setNextToken(undefined);
      lastLoadedAtRef.current = Date.now();
    } catch (e: any) { setError(e?.message ?? 'Load failed'); }
    finally { isLoadingRef.current = false; }
  }, [navigation]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => {
    load();
    // subscribe to toast bus
    try { toastUnsubRef.current?.(); } catch {}
    toastUnsubRef.current = subscribeToasts((msg) => {
      setBanner({ conversationId: '__toast__', preview: msg });
      setTimeout(() => setBanner(curr => (curr && curr.conversationId === '__toast__' ? null : curr)), 4000);
    });
    return () => {
      notifySubsRef.current.forEach(s => { try { s?.unsubscribe?.(); } catch {} });
      try { toastUnsubRef.current?.(); } catch {}
      toastUnsubRef.current = null;
    };
  }, [load]));

  // Subscribe to newly created participant records for me to auto-add new conversations
  useEffect(() => {
    (async () => {
      try {
        const me = await getCurrentUser();
        const client: any = generateClient();
        const subGql = /* GraphQL */ `
          subscription OnCreateConversationParticipant($filter: ModelSubscriptionConversationParticipantFilterInput) {
            onCreateConversationParticipant(filter: $filter) { conversationId userId joinedAt }
          }
        `;
        const op = client.graphql({ query: subGql, variables: { filter: { userId: { eq: me.userId } } }, authMode: 'userPool' }) as any;
        const sub = op.subscribe({
          next: async (evt: any) => {
            const p = evt?.data?.onCreateConversationParticipant;
            try { console.log('[conversations] onCreateConversationParticipant', p); } catch {}
            if (!p?.conversationId) return;
            try {
              const r: any = await getConversation(p.conversationId);
              const conv = r?.data?.getConversation;
              if (!conv?.id) return;
              const latest = await getLatestMessageInConversation(conv.id);
              const partsRes: any = await listParticipantsForConversation(conv.id, 3);
              const parts = partsRes?.data?.conversationParticipantsByConversationIdAndUserId?.items || [];
              const userMap = await batchGetUsersCached(parts.map((x: any) => x.userId));
              setItems(prev => [{ ...conv, _latest: latest, _participants: parts, _users: userMap, _unread: 1 }, ...prev.filter(c => c.id !== conv.id)]);
            } catch {}
          },
          error: () => {},
        });
        notifySubsRef.current.push(sub);
      } catch {}
    })();
    return () => {
      notifySubsRef.current.forEach(s => { try { s?.unsubscribe?.(); } catch {} });
    };
  }, []);

  // Lightweight polling fallback to pick up new conversations if subscription misses
  useEffect(() => {
    const id = setInterval(() => {
      try {
        // quiet poll
        load();
      } catch {}
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Chats</Text>
        <Button title="New Group" onPress={() => navigation.navigate('GroupCreate')} />
      </View>
      {error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item: any) => item.id}
        removeClippedSubviews
        initialNumToRender={16}
        windowSize={7}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={50}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => navigation.navigate('Chat', { conversationId: item.id })}>
            <View style={{ paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#e5e7eb', marginRight: 8, overflow: 'hidden', flexDirection: 'row' }}>
                {/* Simple composite: initials from first 2 participants */}
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 10, color: '#374151' }}>{(item._users?.[item._participants?.[0]?.userId]?.username || 'U1').slice(0,2)}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' }}>
                  <Text style={{ fontSize: 10, color: '#374151' }}>{(item._users?.[item._participants?.[1]?.userId]?.username || 'U2').slice(0,2)}</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }}>
                  {item.name || (item.isGroup ? 'Group' : (item._users?.[item._participants?.find((p:any)=>true)?.userId]?.displayName || item._users?.[item._participants?.find((p:any)=>true)?.userId]?.email || 'Chat'))}
                </Text>
                <Text style={{ color: '#6b7280' }} numberOfLines={1}>
                  {(item._latest?.content || 'yes?')} · {item._latest?.createdAt ? formatTimestamp(item._latest.createdAt) : ''}
                </Text>
              </View>
              {item._unread ? (
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#3b82f6' }} />
              ) : null}
            </View>
          </TouchableOpacity>
        )}
      />
      {banner ? (
        <TouchableOpacity
          onPress={() => {
            const id = banner.conversationId;
            setBanner(null);
            navigation.navigate('Chat', { conversationId: id });
          }}
          style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 10 }}
        >
          <View style={{ backgroundColor: '#111827', padding: 12, borderRadius: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8 }}>
            <Text style={{ color: 'white', fontWeight: '600' }}>New message</Text>
            <Text style={{ color: '#d1d5db' }} numberOfLines={1}>{banner.preview}</Text>
          </View>
        </TouchableOpacity>
      ) : null}
      <Modal visible={showId} transparent animationType="fade" onRequestClose={() => setShowId(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 8, width: '85%' }}>
            <Text style={{ fontWeight: '600', marginBottom: 8 }}>Your ID</Text>
            <Text selectable style={{ marginBottom: 12 }}>{myId}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Button title="Copy" onPress={async () => { try { await Clipboard.setStringAsync(myId); } catch {} setShowId(false); }} />
              <Button title="Close" onPress={() => setShowId(false)} />
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={showSolo} transparent animationType="fade" onRequestClose={() => setShowSolo(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 8, width: '85%' }}>
            <Text style={{ fontWeight: '600', marginBottom: 8 }}>Start Direct Chat</Text>
            <Text style={{ color: '#6b7280', marginBottom: 8 }}>Paste the other user's ID (sub):</Text>
            <View style={{ borderWidth: 1, padding: 8, marginBottom: 12 }}>
              <TextInput
                placeholder="Other user's ID"
                value={soloOtherId}
                onChangeText={setSoloOtherId}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Button title="Cancel" onPress={() => setShowSolo(false)} />
              <Button
                title={soloBusy ? 'Starting…' : 'Start'}
                onPress={async () => {
                  if (!soloOtherId.trim()) return;
                  try {
                    setSoloBusy(true);
                    const me = await getCurrentUser();
                    const a = me.userId;
                    const b = soloOtherId.trim();
                    // Create a fresh unique 1:1 conversation id to start a new thread
                    const freshId = `${[a, b].sort().join('#')}-${Date.now()}`;
                    await ensureDirectConversation(freshId, a, b);
                    // One-time refresh to ensure the new conversation appears immediately
                    try { await load(); } catch {}
                    setShowSolo(false);
                    setSoloBusy(false);
                    navigation.navigate('Chat', { conversationId: freshId, otherUserSub: b });
                  } catch {
                    setSoloBusy(false);
                  }
                }}
                disabled={soloBusy || !soloOtherId.trim()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}


