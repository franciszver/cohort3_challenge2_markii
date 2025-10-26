import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, Button, FlatList, TouchableOpacity, Modal, TextInput, RefreshControl } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentUser, signOut, fetchAuthSession } from 'aws-amplify/auth';
import * as Clipboard from 'expo-clipboard';
import { listConversationsForUser, getConversation, listParticipantsForConversation, ensureDirectConversation, listConversationsByParticipant, ensureParticipant, setMyLastRead, createConversation } from '../graphql/conversations';
import { batchGetUsersCached, getUserById } from '../graphql/users';
import { batchGetProfilesCached } from '../graphql/profile';
import { getLatestMessageInConversation } from '../graphql/messages';
import { formatTimestamp } from '../utils/time';
import { useFocusEffect } from '@react-navigation/native';
import { generateClient } from 'aws-amplify/api';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getFlags } from '../utils/flags';
import { debounce } from '../utils/debounce';
import { subscribeToasts, showToast } from '../utils/toast';
import { getUserProfile, updateUserProfile, invalidateProfileCache } from '../graphql/profile';
import { useTheme } from '../utils/theme';

export default function ConversationListScreen({ navigation }: any) {
  const theme = useTheme();
  const [items, setItems] = useState<any[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [showId, setShowId] = useState(false);
  const [myId, setMyId] = useState<string>('');
  const [showSolo, setShowSolo] = useState(false);
  const [soloOtherId, setSoloOtherId] = useState('');
  const [soloBusy, setSoloBusy] = useState(false);
  const [banner, setBanner] = useState<{ conversationId: string; preview: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const notifySubsRef = useRef<any[]>([]);
  const lastNotifyAtRef = useRef<Record<string, number>>({});
  const toastUnsubRef = useRef<null | (() => void)>(null);
  const [showMe, setShowMe] = useState(false);
  const [meProfile, setMeProfile] = useState<{ firstName?: string; lastName?: string; email?: string } | null>(null);
  const [meSaving, setMeSaving] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  // debug logs removed

  const isLoadingRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const load = useCallback(async (force?: boolean) => {
    try {
      if (isLoadingRef.current) return;
      const now = Date.now();
      if (!force && now - lastLoadedAtRef.current < 1500) return; // staleness guard
      isLoadingRef.current = true;
      setError(null);
      const me = await getCurrentUser();
      setMyId(me.userId);
      // Header actions
      navigation.setOptions({
        headerRight: () => (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="My ID" onPress={() => setShowId(true)} />
            {(() => { try { const { ENABLE_PROFILES } = getFlags(); return ENABLE_PROFILES; } catch { return false; } })() ? (
              <Button title="Profile" onPress={async () => {
                try {
                  const meNow = await getCurrentUser();
                  // Build initial fields from fast local sources first
                  let first = '';
                  let last = '';
                  let email = '';
                  try {
                    const session: any = await fetchAuthSession();
                    const claims: any = session?.tokens?.idToken?.payload || {};
                    first = claims.given_name || '';
                    last = claims.family_name || '';
                    email = claims.email || '';
                  } catch (e) {}
                  try {
                    if (!email) {
                      const meNow2: any = await getCurrentUser();
                      email = meNow2?.username || meNow2?.signInDetails?.loginId || '';
                    }
                  } catch (e) {}
                  // Local cache quick fill
                  try {
                    const localRaw = await AsyncStorage.getItem('profile:self');
                    const local = localRaw ? JSON.parse(localRaw) : null;
                    first = first || (local?.firstName || '');
                    last = last || (local?.lastName || '');
                    email = email || (local?.email || '');
                  } catch (e) {}
                  // Show modal immediately with best-known values
                  setMeProfile({ firstName: first, lastName: last, email });
                  setShowMe(true);
                  // Fetch UserProfile in background with timeout to refine values
                  const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(undefined as unknown as T), ms))]);
                  try {
                    const r: any = await withTimeout(getUserProfile(meNow.userId), 2000);
                    const p = r?.data?.getUserProfile;
                    if (p) {
                      const nf = p.firstName || first;
                      const nl = p.lastName || last;
                      const ne = p.email || email;
                      setMeProfile({ firstName: nf, lastName: nl, email: ne });
                    }
                  } catch (e) {}
                  // As last resort, Users table for email
                  if (!email) {
                    try {
                      const ur: any = await getUserById(meNow.userId);
                      const u = ur?.data?.getUser;
                      if (u?.email) {
                        setMeProfile(prev => ({ ...(prev || {}), email: u.email }));
                      }
                    } catch (e) {}
                  }
                } catch (e) {
                  setMeProfile({ firstName: '', lastName: '', email: '' });
                  setShowMe(true);
                }
              }} />
            ) : null}
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
                try { if (ENABLE_UNREAD_BADGE) Notifications.setBadgeCountAsync?.(next.reduce((acc, c:any)=> acc + (c?._unread ? 1 : 0), 0) as any); } catch {}
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
          let profileMap: Record<string, any> | null = null;
          try {
            const { ENABLE_PROFILES } = getFlags();
            if (ENABLE_PROFILES) profileMap = await batchGetProfilesCached(parts.map((p: any) => p.userId));
          } catch {}
          // compute unread from myLastRead map; if latestFinal newer than lastRead, unread
          let unread = 0;
          const lastRead = myLastRead[c.id];
          const latestTs = latestFinal?.createdAt ? new Date(latestFinal.createdAt).getTime() : 0;
          const lastReadTs = lastRead ? new Date(lastRead).getTime() : 0;
          unread = latestTs > lastReadTs ? 1 : 0;
          convs.push({ ...c, _latest: latestFinal, _participants: parts, _users: userMap, _profiles: profileMap || {}, _unread: unread });
        }
      }
      // Sort by latest activity (latest message createdAt desc)
      convs.sort((a: any, b: any) => {
        const at = a?._latest?.createdAt ? new Date(a._latest.createdAt).getTime() : 0;
        const bt = b?._latest?.createdAt ? new Date(b._latest.createdAt).getTime() : 0;
        return bt - at;
      });
      setAllItems(convs);
      setItems(convs);
      try { await Notifications.setBadgeCountAsync?.((ENABLE_UNREAD_BADGE ? convs.reduce((acc, c:any)=> acc + (c?._unread ? 1 : 0), 0) : 0) as any); } catch {}
      setNextToken(undefined);
      lastLoadedAtRef.current = Date.now();
    } catch (e: any) { setError(e?.message ?? 'Load failed'); }
    finally { isLoadingRef.current = false; setIsInitialLoading(false); }
  }, [navigation]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => {
    load(true);
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

  const { ENABLE_CONVERSATION_LIST_UX, ENABLE_UNREAD_BADGE } = getFlags();

  async function recomputeBadge(nextItems?: any[]) {
    try {
      if (!ENABLE_UNREAD_BADGE) return;
      const arr = nextItems || items;
      const total = (arr || []).reduce((acc, c: any) => acc + (c?._unread ? 1 : 0), 0);
      await Notifications.setBadgeCountAsync?.(total as any);
    } catch {}
  }

  // Debounced search filter
  const applyFilter = useMemo(() => debounce((q: string) => {
    const term = (q || '').trim().toLowerCase();
    if (!term) { setItems(allItems); return; }
    const filtered = allItems.filter((c: any) => {
      const name = (c.name || '').toLowerCase();
      const latest = (c._latest?.content || '').toLowerCase();
      const users = Object.values(c._users || {}) as any[];
      const profiles = Object.values(c._profiles || {}) as any[];
      const userText = users.map(u => `${u.displayName||''} ${u.email||''} ${u.username||''}`.toLowerCase()).join(' ');
      const profileText = profiles.map((p:any)=> `${p.firstName||''} ${p.lastName||''} ${p.email||''}`.toLowerCase()).join(' ');
      return name.includes(term) || latest.includes(term) || userText.includes(term) || profileText.includes(term);
    });
    setItems(filtered);
  }, 200, { trailing: true }), [allItems]);

  useEffect(() => { if (ENABLE_CONVERSATION_LIST_UX) applyFilter(query); }, [query, allItems, ENABLE_CONVERSATION_LIST_UX, applyFilter]);

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: theme.colors.background }}>
      {null}
      {(() => { try { const { ASSISTANT_ENABLED } = getFlags(); return ASSISTANT_ENABLED; } catch { return false; } })() ? (
        <TouchableOpacity
          onPress={async () => {
            try {
              const me = await getCurrentUser();
              const cid = `assistant::${me.userId}`;
              try {
                const r: any = await getConversation(cid);
                const exists = !!r?.data?.getConversation?.id;
                if (!exists) {
                  try { await createConversation('Assistant', false, [me.userId], cid); } catch {}
                  try { await load(true); } catch {}
                }
              } catch {
                try { await createConversation('Assistant', false, [me.userId], cid); } catch {}
              }
              navigation.navigate('Chat', { conversationId: cid });
            } catch {}
          }}
          accessibilityLabel="Open Assistant"
          style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 20, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}
        >
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>Ai+</Text>
        </TouchableOpacity>
      ) : null}
      {null}
      {error ? (
        <View style={{ paddingVertical: 12 }}>
          <Text style={{ color: 'red', marginBottom: 8 }}>{error}</Text>
          <Button title="Retry" onPress={() => { setError(null); setIsInitialLoading(true); load(true); }} />
        </View>
      ) : null}
      {ENABLE_CONVERSATION_LIST_UX && isInitialLoading ? (
        <View>
          {Array.from({ length: 10 }).map((_, i) => (
            <View key={i} style={{ paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#e5e7eb', marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <View style={{ height: 12, backgroundColor: '#e5e7eb', borderRadius: 6, width: '40%', marginBottom: 6 }} />
                <View style={{ height: 10, backgroundColor: '#f3f4f6', borderRadius: 5, width: '70%' }} />
              </View>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: 'transparent' }} />
            </View>
          ))}
        </View>
      ) : null}
      {!isInitialLoading && ENABLE_CONVERSATION_LIST_UX && items.length === 0 ? (
        <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 48 }}>
          {query.trim() ? (
            <>
              <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 6 }}>No results</Text>
              <Text style={{ color: '#6b7280', marginBottom: 12 }}>No chats match "{query}". Try a different term.</Text>
              <Button title="Clear search" onPress={() => setQuery('') } />
            </>
          ) : (
            <>
              <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 6 }}>Start a chat</Text>
              <Text style={{ color: '#6b7280', marginBottom: 12 }}>You don’t have any conversations yet.</Text>
            </>
          )}
        </View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item: any) => item.id}
        removeClippedSubviews
        initialNumToRender={16}
        windowSize={7}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={50}
        refreshControl={(() => { try { const { ENABLE_MESSAGES_PULL_TO_REFRESH } = getFlags(); return ENABLE_MESSAGES_PULL_TO_REFRESH ? (
          <RefreshControl refreshing={refreshing} onRefresh={async () => { try { setRefreshing(true); await load(true); } catch {} finally { setRefreshing(false); } }} />
        ) : undefined; } catch { return undefined; } })()}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => { setItems(prev => { const next = prev.map((c:any)=> c.id === item.id ? { ...c, _unread: 0 } : c); try { if (ENABLE_UNREAD_BADGE) Notifications.setBadgeCountAsync?.(next.reduce((acc, c:any)=> acc + (c?._unread ? 1 : 0), 0) as any); } catch {}; return next; }); navigation.navigate('Chat', { conversationId: item.id }); }}>
            <View style={{ paddingVertical: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8, minHeight: 64 }}>
          {(() => { try { const { ENABLE_PROFILES } = getFlags(); return ENABLE_PROFILES; } catch { return false; } })() ? (
            <View style={{ width: 32, height: 32, borderRadius: 16, marginRight: 8, overflow: 'hidden', flexDirection: 'row' }}>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e5e7eb' }}>
                <Text style={{ fontSize: 10, color: '#111827' }}>
                  {(() => { const p = item._profiles?.[item._participants?.[0]?.userId]; if (p) return `${(p.firstName||'').slice(0,1)}${(p.lastName||'').slice(0,1)}`.toUpperCase() || 'U1'; return (item._users?.[item._participants?.[0]?.userId]?.username || 'U1').slice(0,2); })()}
                </Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' }}>
                <Text style={{ fontSize: 10, color: '#111827' }}>
                  {(() => { const p = item._profiles?.[item._participants?.[1]?.userId]; if (p) return `${(p.firstName||'').slice(0,1)}${(p.lastName||'').slice(0,1)}`.toUpperCase() || 'U2'; return (item._users?.[item._participants?.[1]?.userId]?.username || 'U2').slice(0,2); })()}
                </Text>
              </View>
            </View>
          ) : (
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#e5e7eb', marginRight: 8, overflow: 'hidden', flexDirection: 'row' }}>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 10, color: '#374151' }}>{(item._users?.[item._participants?.[0]?.userId]?.username || 'U1').slice(0,2)}</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' }}>
                <Text style={{ fontSize: 10, color: '#374151' }}>{(item._users?.[item._participants?.[1]?.userId]?.username || 'U2').slice(0,2)}</Text>
              </View>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: item._unread ? '700' : '600', color: theme.colors.textPrimary }}>
              {(() => {
                const { ENABLE_PROFILES } = getFlags();
                  if (item.name) return item.name;
                  if (item.isGroup) {
                    const initials = (item._participants || []).slice(0, 3).map((p:any) => {
                      if (ENABLE_PROFILES) {
                        const prof = item._profiles?.[p.userId];
                        if (prof && (prof.firstName || prof.lastName)) return `${prof.firstName||''} ${prof.lastName||''}`.trim();
                      }
                      const u = item._users?.[p.userId];
                      return (u?.displayName || u?.email || u?.username || 'User').split('@')[0];
                    }).filter(Boolean).join(', ');
                    return initials || 'Group';
                  }
                const first = item._participants?.find((p:any)=>p?.userId && p.userId !== myId) || item._participants?.[0];
                if (ENABLE_PROFILES) {
                  const p = first ? item._profiles?.[first.userId] : null;
                  if (p && (p.firstName || p.lastName)) return `${p.firstName||''} ${p.lastName||''}`.trim();
                }
                const u = first ? item._users?.[first.userId] : null;
                return (u?.displayName || u?.email || 'Chat');
              })()}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontWeight: item._unread ? '600' : '400' }} numberOfLines={1}>
              {(item._latest?.content || 'new')} · {item._latest?.createdAt ? formatTimestamp(item._latest.createdAt) : ''}
            </Text>
          </View>
          {item._unread ? (
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary }} />
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
      <Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 8, width: '85%' }}>
            <Text style={{ fontWeight: '600', marginBottom: 8 }}>Assistant – Getting Started</Text>
            <Text style={{ color: '#111827', marginBottom: 8 }}>Try these:</Text>
            <Text style={{ color: '#6b7280', marginBottom: 4 }}>• “Hello”</Text>
            <Text style={{ color: '#6b7280', marginBottom: 4 }}>• “Plan Saturday: park in the morning, pizza for lunch”</Text>
            <Text style={{ color: '#6b7280', marginBottom: 4 }}>• “Ingredient: tomato”, then later “Make a recipe”</Text>
            <Text style={{ color: '#6b7280', marginBottom: 12 }}>You’ll see a friendly summary and a simple plan.</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Button title="Close" onPress={() => setShowHelp(false)} />
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
                    try { await load(true); } catch {}
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
      <Modal visible={showMe} transparent animationType="fade" onRequestClose={() => { setShowMe(false); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 8, width: '85%' }}>
            <Text style={{ fontWeight: '600', marginBottom: 8 }}>Your Profile</Text>
            <Text style={{ color: '#6b7280', marginBottom: 8 }}>Edit your first and last name:</Text>
            <View style={{ borderWidth: 1, padding: 8, marginBottom: 8, backgroundColor: '#f9fafb' }}>
              <Text style={{ color: '#6b7280', marginBottom: 4 }}>Email (read-only)</Text>
              <Text selectable>{meProfile?.email || '(not available)'}</Text>
            </View>
            <View style={{ borderWidth: 1, padding: 8, marginBottom: 8 }}>
              <TextInput placeholder="First Name" value={meProfile?.firstName || ''} onChangeText={(v)=>{ setMeProfile(p=>({ ...(p||{}), firstName: v })); }} />
            </View>
            <View style={{ borderWidth: 1, padding: 8, marginBottom: 12 }}>
              <TextInput placeholder="Last Name" value={meProfile?.lastName || ''} onChangeText={(v)=>{ setMeProfile(p=>({ ...(p||{}), lastName: v })); }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Button title="Cancel" onPress={() => { setShowMe(false); }} />
              <Button
                title={meSaving ? 'Saving…' : 'Save'}
                onPress={async () => {
                  if (!meProfile) return;
                  setMeSaving(true);
                  let ok = false;
                  try {
                    const r: any = await updateUserProfile({ firstName: (meProfile.firstName||'').trim() || undefined, lastName: (meProfile.lastName||'').trim() || undefined });
                    const hasErrors = !!(r?.errors && r.errors.length);
                    if (hasErrors || !r?.data?.updateUserProfile) {
                      try { showToast('Save failed'); } catch {}
                      ok = false;
                    } else {
                      ok = true;
                    }
                    try { await AsyncStorage.setItem('profile:self', JSON.stringify({ firstName: (meProfile.firstName||'').trim(), lastName: (meProfile.lastName||'').trim(), email: meProfile.email || '' })); } catch {}
                  } catch (e) {}
                  finally {
                    setMeSaving(false);
                    if (ok) {
                      setShowMe(false);
                    } else {
                    }
                    try { const meNow = await getCurrentUser(); invalidateProfileCache(meNow.userId); } catch {}
                    try { showToast(ok ? 'Profile updated' : 'Saved (with warnings)'); } catch {}
                  }
                }}
                disabled={meSaving}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}


