import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, Button, FlatList, TouchableOpacity, Modal, TextInput, RefreshControl } from 'react-native';
import { useFonts, DancingScript_700Bold } from '@expo-google-fonts/dancing-script';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentUser, signOut, fetchAuthSession } from 'aws-amplify/auth';
import * as Clipboard from 'expo-clipboard';
import { listConversationsForUser, getConversation, listParticipantsForConversation, listConversationsByParticipant, ensureParticipant, setMyLastRead, createConversation } from '../graphql/conversations';
import { getUserById } from '../graphql/users';
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
import { preloadNicknames, getAllNicknames } from '../utils/nicknames';

export default function ConversationListScreen({ route, navigation }: any) {
  const [titleFontsLoaded] = useFonts({ DancingScript_700Bold });
  const theme = useTheme();
  const [items, setItems] = useState<any[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [showId, setShowId] = useState(false);
  const [myId, setMyId] = useState<string>('');
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
  const [showMenu, setShowMenu] = useState(false);
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  // debug logs removed

  async function openProfile() {
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
  }

  const isLoadingRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const load = useCallback(async (force?: boolean) => {
    try {
      if (isLoadingRef.current) return;
      const now = Date.now();
      if (!force && now - lastLoadedAtRef.current < 1500) return; // staleness guard
      isLoadingRef.current = true;
      setError(null);
      // Load nicknames early
      try {
        await preloadNicknames();
        const allNicknames = await getAllNicknames();
        setNicknames(allNicknames);
      } catch (e) {
        console.warn('[list] Failed to load nicknames:', e);
      }
      const me = await getCurrentUser();
      setMyId(me.userId);
      // Header actions and theming
      navigation.setOptions({
        headerTitle: () => (
          <Text style={{ fontSize: 26, color: theme.colors.textPrimary, fontFamily: titleFontsLoaded ? 'DancingScript_700Bold' : undefined }}>NegotiatedAi</Text>
        ),
        headerStyle: { backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border, borderBottomWidth: 1 },
        headerTitleAlign: 'center',
        headerRight: () => (
          <TouchableOpacity accessibilityLabel="Menu" onPress={() => setShowMenu(true)} style={{ paddingHorizontal: 12, paddingVertical: 8, minHeight: 44, justifyContent: 'center' }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 22, color: theme.colors.textPrimary }}>☰</Text>
          </TouchableOpacity>
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

              // Check if user is currently viewing this conversation - suppress notifications if so
              try {
                const { getActiveConversation } = await import('../utils/notify');
                const activeConv = getActiveConversation();
                if (activeConv === id) {
                  // User is viewing this chat, skip all notifications
                  return;
                }
              } catch {}

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
              // Force refresh latest page for the target conversation in list to avoid stale cache
              try { await load(true); } catch {}
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
          // fetch participant subset (first 3)
          const partsRes: any = await listParticipantsForConversation(c.id, 3);
          const parts = partsRes?.data?.conversationParticipantsByConversationIdAndUserId?.items || [];
          // compute unread from myLastRead map; if latestFinal newer than lastRead, unread
          let unread = 0;
          const lastRead = myLastRead[c.id];
          const latestTs = latestFinal?.createdAt ? new Date(latestFinal.createdAt).getTime() : 0;
          const lastReadTs = lastRead ? new Date(lastRead).getTime() : 0;
          unread = latestTs > lastReadTs ? 1 : 0;
          convs.push({ ...c, _latest: latestFinal, _participants: parts, _unread: unread });
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
    } catch (e: any) { setError(e?.message || 'Load failed'); }
    finally { isLoadingRef.current = false; setIsInitialLoading(false); }
  }, [navigation, theme.colors.border, theme.colors.surface, theme.colors.textPrimary, titleFontsLoaded]);

  useEffect(() => { load(); }, [load]);
  // Show hint when coming from Auth
  useEffect(() => {
    try {
      if (route?.params?.fromAuth) {
        showToast('Quick actions available: + New Convo • Ai');
        // clear flag so it shows only when explicitly coming again from Auth
        try { navigation.setParams({ fromAuth: undefined }); } catch {}
      }
    } catch {}
  }, [route?.params?.fromAuth]);

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('handoff:conv-rename');
        if (raw) {
          try {
            const payload = JSON.parse(raw || '{}');
            const id = payload?.id;
            const name = payload?.name ?? '';
            if (id) {
              setItems(prev => prev.map((c:any) => c.id === id ? { ...c, name } : c));
              setAllItems(prev => prev.map((c:any) => c.id === id ? { ...c, name } : c));
            }
          } catch {}
          try { await AsyncStorage.removeItem('handoff:conv-rename'); } catch {}
        }
      } catch {}
      try { await load(true); } catch {}
    })();
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
              setItems(prev => [{ ...conv, _latest: latest, _participants: parts, _unread: 1 }, ...prev.filter(c => c.id !== conv.id)]);
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
      // Search by nicknames and userIds
      const participantText = (c._participants || []).map((p: any) => {
        const uid = p.userId || '';
        const nickname = nicknames[uid] || '';
        return `${nickname} ${uid}`.toLowerCase();
      }).join(' ');
      return name.includes(term) || latest.includes(term) || participantText.includes(term);
    });
    setItems(filtered);
  }, 200, { trailing: true }), [allItems, nicknames]);

  useEffect(() => { if (ENABLE_CONVERSATION_LIST_UX) applyFilter(query); }, [query, allItems, ENABLE_CONVERSATION_LIST_UX, applyFilter]);

  return (
    <View style={{ flex: 1, padding: 12, backgroundColor: theme.colors.background }}>
      {null}
      <View style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 20, alignItems: 'flex-end', gap: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.navigate('GroupCreate')}
          accessibilityLabel="New conversation"
          style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>+ New Convo</Text>
        </TouchableOpacity>
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
            style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3, minHeight: 44, justifyContent: 'center' }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>Ai</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {null}
      {error ? (
        <View style={{ paddingVertical: 12 }}>
          <Text style={{ color: theme.colors.danger, marginBottom: 8 }}>{error}</Text>
          <Button title="Retry" onPress={() => { setError(null); setIsInitialLoading(true); load(true); }} />
        </View>
      ) : null}
      {ENABLE_CONVERSATION_LIST_UX && isInitialLoading ? (
        <View>
          {Array.from({ length: 10 }).map((_, i) => (
            <View key={i} style={{ paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.border, marginRight: 8 }} />
              <View style={{ flex: 1 }}>
                <View style={{ height: 12, backgroundColor: theme.colors.border, borderRadius: 6, width: '40%', marginBottom: 6 }} />
                <View style={{ height: 10, backgroundColor: theme.colors.inputBackground, borderRadius: 5, width: '70%' }} />
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
              <Text style={{ color: theme.colors.textSecondary, marginBottom: 12 }}>No chats match "{query}". Try a different term.</Text>
              <Button title="Clear search" onPress={() => setQuery('') } />
            </>
          ) : (
            <>
              <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 6 }}>Start a chat</Text>
              <Text style={{ color: theme.colors.textSecondary, marginBottom: 12 }}>You don’t have any conversations yet.</Text>
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
          <TouchableOpacity onPress={() => { setItems(prev => { const next = prev.map((c:any)=> c.id === item.id ? { ...c, _unread: 0 } : c); try { if (ENABLE_UNREAD_BADGE) Notifications.setBadgeCountAsync?.(next.reduce((acc, c:any)=> acc + (c?._unread ? 1 : 0), 0) as any); } catch {}; return next; }); try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[nav:openChat]', { conversationId: item.id }); } catch {}; navigation.navigate('Chat', { conversationId: item.id }); }}>
            <View style={{ paddingVertical: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8, minHeight: 64 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.border, marginRight: 8, overflow: 'hidden', flexDirection: 'row' }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 10, color: theme.colors.textSecondary }}>
                {(() => {
                  const uid = item._participants?.[0]?.userId;
                  const displayName = uid ? (nicknames[uid] || uid) : 'U1';
                  return displayName.slice(0, 4);
                })()}
              </Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.inputBackground }}>
              <Text style={{ fontSize: 10, color: theme.colors.textSecondary }}>
                {(() => {
                  const uid = item._participants?.[1]?.userId;
                  const displayName = uid ? (nicknames[uid] || uid) : 'U2';
                  return displayName.slice(0, 4);
                })()}
              </Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: item._unread ? '700' : '600', color: theme.colors.textPrimary }}>
              {(() => {
                if (item.name) return item.name;
                if (item.isGroup) {
                  const names = (item._participants || []).slice(0, 3).map((p:any) => {
                    const uid = p.userId;
                    return nicknames[uid] || uid;
                  }).filter(Boolean).join(', ');
                  return names || 'Group';
                }
                const first = item._participants?.find((p:any)=>p?.userId && p.userId !== myId) || item._participants?.[0];
                const uid = first?.userId;
                return uid ? (nicknames[uid] || uid) : 'Chat';
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
          <View style={{ backgroundColor: theme.colors.surface, padding: theme.spacing.md, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.colors.border, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>New message</Text>
            <Text numberOfLines={1} style={{ color: theme.colors.textSecondary }}>{banner.preview}</Text>
          </View>
        </TouchableOpacity>
      ) : null}
      {/* Hamburger menu modal */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setShowMenu(false)} style={{ flex: 1, backgroundColor: theme.colors.overlay }}>
          <View style={{ position: 'absolute', top: 56, right: 12, backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 12, padding: 8, minWidth: 220, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 2 } }}>
            <TouchableOpacity accessibilityRole="button" onPress={() => { setShowMenu(false); setShowId(true); }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 8, minHeight: 44 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.buttonPrimaryBg, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 12 }}>ID</Text>
              </View>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>My ID</Text>
            </TouchableOpacity>
            {(() => { try { const { ENABLE_PROFILES } = getFlags(); return ENABLE_PROFILES; } catch { return false; } })() ? (
              <>
                <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />
                <TouchableOpacity accessibilityRole="button" onPress={() => { setShowMenu(false); openProfile(); }}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 8, minHeight: 44 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.buttonPrimaryBg, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                    <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 12 }}>👤</Text>
                  </View>
                  <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Profile</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />
            <TouchableOpacity accessibilityRole="button" onPress={async () => { setShowMenu(false); try { await signOut(); } catch {} navigation.replace('Auth'); }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 8, minHeight: 44 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.buttonPrimaryBg, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                <Text style={{ color: theme.colors.textPrimary, fontWeight: '700', fontSize: 12 }}>⎋</Text>
              </View>
              <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      <Modal visible={showId} transparent animationType="fade" onRequestClose={() => setShowId(false)}>
        <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
            <Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Your ID</Text>
            <Text selectable style={{ marginBottom: theme.spacing.md, color: theme.colors.textPrimary }}>{myId}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Button title="Copy" onPress={async () => { try { await Clipboard.setStringAsync(myId); } catch {} setShowId(false); }} />
              <Button title="Close" onPress={() => setShowId(false)} />
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={showHelp} transparent animationType="fade" onRequestClose={() => setShowHelp(false)}>
        <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
            <Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Assistant – Getting Started</Text>
            <Text style={{ color: theme.colors.textPrimary, marginBottom: theme.spacing.sm }}>Try these:</Text>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: 4 }}>• “Hello”</Text>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: 4 }}>• “Plan Saturday: park in the morning, pizza for lunch”</Text>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: 4 }}>• “Ingredient: tomato”, then later “Make a recipe”</Text>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.md }}>You’ll see a friendly summary and a simple plan.</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Button title="Close" onPress={() => setShowHelp(false)} />
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={showMe} transparent animationType="fade" onRequestClose={() => { setShowMe(false); }}>
        <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
            <Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Your Profile</Text>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: theme.spacing.sm }}>Edit your first and last name:</Text>
            <View style={{ borderWidth: 1, padding: theme.spacing.sm, marginBottom: theme.spacing.sm, backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border }}>
              <Text style={{ color: theme.colors.textSecondary, marginBottom: 4 }}>Email (read-only)</Text>
              <Text selectable style={{ color: theme.colors.textPrimary }}>{meProfile?.email || '(not available)'}</Text>
            </View>
            <View style={{ borderWidth: 1, padding: theme.spacing.sm, marginBottom: theme.spacing.sm, borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground }}>
              <TextInput placeholder="First Name" value={meProfile?.firstName || ''} onChangeText={(v)=>{ setMeProfile(p=>({ ...(p||{}), firstName: v })); }} />
            </View>
            <View style={{ borderWidth: 1, padding: theme.spacing.sm, marginBottom: theme.spacing.md, borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground }}>
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


