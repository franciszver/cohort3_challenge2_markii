import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, TextInput, Button, Text, Image, TouchableOpacity, TouchableWithoutFeedback, Modal, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Calendar from 'expo-calendar';
import { formatTimestamp, formatLastSeen } from '../utils/time';
import { listMessagesCompat, sendTextMessageCompat, subscribeMessagesCompat, markDelivered, markRead, sendTyping, subscribeTyping, getReceiptForMessageUser, getMessageById } from '../graphql/messages';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { updateLastSeen, subscribeUserPresence, batchGetUsersCached, getEmailCacheSnapshot } from '../graphql/users';
import { setMyLastRead, ensureDirectConversation, deleteConversationById, subscribeConversationDeleted, updateConversationLastMessage, getConversation, updateConversationName } from '../graphql/conversations';
import { showToast } from '../utils/toast';
import { debounce } from '../utils/debounce';
import { mergeDedupSort } from '../utils/messages';
import { generateLocalId } from '../utils/ids';
import { getFlags } from '../utils/flags';
import Constants from 'expo-constants';
import { getUserProfile } from '../graphql/profile';
import Avatar from '../components/Avatar';
import { useTheme } from '../utils/theme';

function conversationIdFor(a: string, b: string) {
	return [a, b].sort().join('#');
}

export default function ChatScreen({ route, navigation }: any) {
	const theme = useTheme();
	const [messages, setMessages] = useState<any[]>([]);
	const [userIdToEmail, setUserIdToEmail] = useState<Record<string, string>>({});
	const [myEmail, setMyEmail] = useState<string>('');
	const [convName, setConvName] = useState<string>('');
	const [isGroup, setIsGroup] = useState<boolean>(false);
	const [participantIds, setParticipantIds] = useState<string[]>([]);
	const [participantsVisible, setParticipantsVisible] = useState(false);
	const [input, setInput] = useState('');
	const [error, setError] = useState<string | null>(null);
	const listRef = useRef<any>(null);
	const messageInputRef = useRef<any>(null);
	const subRef = useRef<any>(null);
	const typingSubRef = useRef<any>(null);
	const receiptsSubRef = useRef<any>(null);
	const deleteSubRef = useRef<any>(null);
	const presenceSubRef = useRef<any>(null);
	const typingTimerRef = useRef<any>(null);
	const lastTypingSentRef = useRef<number>(0);
	const [isTyping, setIsTyping] = useState(false);
	const [nextToken, setNextToken] = useState<string | undefined>(undefined);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
    const retryTimerRef = useRef<any>(null);
    const drainIntervalRef = useRef<any>(null);
    // Add-to-group feature state (flag-gated)
    const [addVisible, setAddVisible] = useState(false);
    const [addInput, setAddInput] = useState('');
    const [addBusy, setAddBusy] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [conversationId, setConversationId] = useState<string>('');
	const didInitialScrollRef = useRef(false);
	const isNearBottomRef = useRef(true);
	const isUserDraggingRef = useRef(false);
	const isFocused = useIsFocused();
const otherUserId = route.params?.otherUserSub as string;
	const providedConversationId = route.params?.conversationId as string | undefined;
	const [infoVisible, setInfoVisible] = useState(false);
	const [infoText, setInfoText] = useState<string>('');
	const [menuVisible, setMenuVisible] = useState(false);
	const [renameVisible, setRenameVisible] = useState(false);
	const [renameInput, setRenameInput] = useState('');
	const [renameBusy, setRenameBusy] = useState(false);
	const [renameError, setRenameError] = useState<string | null>(null);
const [otherProfile, setOtherProfile] = useState<any | null>(null);
const [myId, setMyId] = useState<string>('');
const [otherUserResolved, setOtherUserResolved] = useState<string | undefined>(undefined);
const [otherLastSeen, setOtherLastSeen] = useState<string | undefined>(undefined);
const [isSendingMsg, setIsSendingMsg] = useState(false);
const [assistantPending, setAssistantPending] = useState(false);
const assistantTimerRef = useRef<any>(null);
	const latestRefreshInFlightRef = useRef(false);
// Calendar picker state
const [calPickVisible, setCalPickVisible] = useState(false);
const [calChoices, setCalChoices] = useState<any[]>([]);
const [calBusy, setCalBusy] = useState(false);
const calPendingEventsRef = useRef<any[] | null>(null);
const calTargetIdRef = useRef<string | null>(null);
// Recipes modal state
const [recipesVisible, setRecipesVisible] = useState(false);
const [recipesItems, setRecipesItems] = useState<any[]>([]);
// Decisions modal state
const [decisionsVisible, setDecisionsVisible] = useState(false);
const [decisionsItems, setDecisionsItems] = useState<any[]>([]);

	// Ensure emails for a set of user ids using multiple sources
	async function ensureEmails(userIds: string[]) {
		try {
			const ids = Array.from(new Set((userIds || []).filter(Boolean)));
			const missing = ids.filter(id => !userIdToEmail[id]);
			if (!missing.length) return;
			// First: Users table (batch)
			let map: Record<string, string> = {};
			try {
				const usersMap = await batchGetUsersCached(missing);
				for (const uid of Object.keys(usersMap || {})) {
					const u = (usersMap as any)[uid];
					if (u?.email) map[uid] = u.email;
				}
			} catch {}
			// Second: Profiles table (per id)
			for (const uid of missing) {
				if (map[uid]) continue;
				try {
					const r:any = await getUserProfile(uid);
					const p = r?.data?.getUserProfile;
					const email = p?.email;
					if (email) map[uid] = email;
				} catch {}
			}
			if (Object.keys(map).length) setUserIdToEmail(prev => ({ ...prev, ...map }));
		} catch {}
	}

	// Debounced lastRead setter
	const debouncedSetLastRead = useRef(
		debounce(async (cid: string, uid: string) => {
			try { await setMyLastRead(cid, uid, new Date().toISOString()); } catch {}
		}, 500, { trailing: true })
	).current;

	useEffect(() => {
		(async () => {
			let cid: string | undefined;
			let otherId: string | undefined;
			try {
                const me = await getCurrentUser();
                setMyId(me.userId);
                // Resolve my email from Cognito ID token, fallbacks to username/loginId and cache
                try {
                    const session: any = await fetchAuthSession();
                    const claims: any = session?.tokens?.idToken?.payload || {};
                    const tokenEmail = (claims?.email || '').trim();
                    let fallbackEmail = '';
                    try { fallbackEmail = (me as any)?.username || (me as any)?.signInDetails?.loginId || ''; } catch {}
                    const cached = getEmailCacheSnapshot()[me.userId];
                    const finalEmail = tokenEmail || cached || fallbackEmail;
                    if (finalEmail) setMyEmail(finalEmail);
                } catch {}
				cid = providedConversationId || (otherUserId ? conversationIdFor(me.userId, otherUserId) : undefined);
                try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:init] me', me.userId, 'otherParam', otherUserId, 'cid', cid); } catch {}
				if (!cid) throw new Error('No conversation target');
                setConversationId(cid);
				// Resolve other participant if provided via route
				otherId = otherUserId as string | undefined;
                // Load conversation metadata (name, group)
                try {
                    const r: any = await getConversation(cid);
                    const c = r?.data?.getConversation;
                    if (c) { setConvName(c.name || ''); setIsGroup(!!c.isGroup); }
                } catch {}
                setOtherUserResolved(otherId);
                // Ensure I am a participant in this conversation to satisfy auth rules for message reads
                try {
                    const { ensureParticipant } = await import('../graphql/conversations');
                    await ensureParticipant(cid, me.userId, 'MEMBER');
                    try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:participant] ensured', me.userId, 'in', cid); } catch {}
                } catch { try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:participant] ensure failed (non-fatal)'); } catch {} }
                // Prefetch other participant's email for labeling
                // Removed: relying on metadata only
                // Resolve other participant profile (flagged)
                try {
                    const { ENABLE_PROFILES } = getFlags();
                    if (ENABLE_PROFILES && otherId) {
                        const r: any = await getUserProfile(otherId);
                        const p = r?.data?.getUserProfile;
                        if (p) setOtherProfile(p);
                    }
                } catch {}
				// Ensure direct conversation exists when entering from 1:1 flow
                if (!providedConversationId && otherId) {
                    try { await ensureDirectConversation(cid, me.userId, otherId); } catch {}
				}
				// Set lastReadAt immediately on entering chat
				try { await setMyLastRead(cid, me.userId, new Date().toISOString()); } catch {}
				// subscribe to new messages in this conversation (first, to avoid missing messages)
                const subscribe = subscribeMessagesCompat(cid);
				const sub = subscribe({
					next: async (evt: any) => {
						try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[sub] evt', evt); } catch {}
						const m = evt?.data?.onMessageInConversation;
						if (!m || !m.id) { try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[sub] skip invalid message', m); } catch {} ; return; }
						// Opportunistic presence update on inbound activity
						try { const meNow = await getCurrentUser(); await updateLastSeen(meNow.userId); } catch {}
						setMessages(prev => {
							const next = mergeDedupSort(prev, [m]);
							AsyncStorage.setItem(`history:${cid}`, JSON.stringify(next)).catch(() => {});
						// Recompute active participants from latest 50 messages
							try {
							const latest = next.slice(0, 50);
								const ids = Array.from(new Set(latest.map((mm:any) => mm.senderId).filter(Boolean)));
								setParticipantIds(ids);
							} catch {}
							return next;
						});
                        // Update email map for sender on the fly (metadata only, no lookups)
                        try {
                            const sid = m?.senderId;
                            // Prefer metadata.email when present
                            try {
                                const metaAny = (() => { try { return typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {}); } catch { return {}; } })();
                                const em = (metaAny && typeof metaAny.email === 'string') ? metaAny.email.trim() : '';
                                if (sid && em && !userIdToEmail[sid]) setUserIdToEmail(prev => ({ ...prev, [sid]: em }));
                            } catch {}
                        } catch {}
                        // Calendar CTA (flag-gated) — if metadata missing in sub payload, refetch message once to get metadata
						try {
							const { ASSISTANT_CALENDAR_ENABLED } = getFlags();
							if (ASSISTANT_CALENDAR_ENABLED && m?.senderId === 'assistant-bot') {
								// Best-effort parse of metadata
                                let meta = (() => { try { return typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {}); } catch { return {}; } })();
                                if (!meta?.events) {
                                    // Retry a few times to let backend update metadata
                                    for (let i = 0; i < 5 && !(meta?.events && meta.events.length); i++) {
                                        try {
                                            const full = await getMessageById(m.id);
                                            meta = (() => { try { return typeof full?.metadata === 'string' ? JSON.parse(full.metadata) : (full?.metadata || {}); } catch { return {}; } })();
                                            try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[meta] attempt', i+1, 'events=', Array.isArray(meta?.events) ? meta.events.length : 0); } catch {}
                                        } catch {}
                                        if (!(meta?.events && meta.events.length)) {
                                            const delay = 250 + i*300; // ~250,550,850,1150,1450ms
                                            await new Promise(r => setTimeout(r, delay));
                                        }
                                    }
                                }
                                // Final fallback: check attachments for embedded events payload (events:<json> or events:<base64>)
                                if (!(meta?.events && meta.events.length) && Array.isArray((m as any).attachments)) {
                                    try {
                                        const hit = (m as any).attachments.find((a:any)=> typeof a === 'string' && a.startsWith('events:'));
                                        if (hit) {
                                            const payload = hit.slice('events:'.length);
                                            let obj: any = null;
                                            try { obj = JSON.parse(payload); } catch {
                                                try { obj = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')); } catch {}
                                            }
                                            if (obj && Array.isArray(obj.events) && obj.events.length) {
                                                meta = { ...(meta || {}), events: obj.events };
                                                try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[meta] attachment events found =', obj.events.length); } catch {}
                                                // Decorate message locally so CTA can render immediately
                                                try {
                                                    const decorated2 = { ...m, metadata: JSON.stringify({ ...(meta||{}), events: obj.events }) } as any;
                                                    setMessages(prev => mergeDedupSort(prev, [decorated2]));
                                                } catch {}
                                            }
                                        }
                                    } catch {}
                                }
                                if (meta?.events && Array.isArray(meta.events) && meta.events.length) {
                                    // Store marker and decorate message locally
                                    try { await AsyncStorage.setItem(`cal:${m.id}`, JSON.stringify({ events: meta.events })); } catch {}
                                    try {
                                        const decorated = { ...m, metadata: JSON.stringify({ ...(meta||{}), events: meta.events }) } as any;
                                        setMessages(prev => mergeDedupSort(prev, [decorated]));
                                    } catch {}
                                }
							}
						} catch {}
                        // Decisions CTA enrichment (flag-gated)
                        try {
                            const { ASSISTANT_DECISIONS_ENABLED } = getFlags();
                            if (ASSISTANT_DECISIONS_ENABLED && m?.senderId === 'assistant-bot') {
                                let metaAny = (() => { try { return typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {}); } catch { return {}; } })();
                                let decs: any[] = Array.isArray((metaAny as any)?.decisions) ? (metaAny as any).decisions : [];
                                if (!decs.length) {
                                    // Retry fetch to allow backend metadata updates
                                    for (let i = 0; i < 5 && !(decs && decs.length); i++) {
                                        try {
                                            const full = await getMessageById(m.id);
                                            const meta2 = (() => { try { return typeof full?.metadata === 'string' ? JSON.parse(full.metadata) : (full?.metadata || {}); } catch { return {}; } })();
                                            if (Array.isArray((meta2 as any)?.decisions) && (meta2 as any).decisions.length) {
                                                metaAny = meta2;
                                                decs = (meta2 as any).decisions;
                                                break;
                                            }
                                        } catch {}
                                        const delay = 250 + i*300;
                                        await new Promise(r => setTimeout(r, delay));
                                    }
                                }
                                if (!(decs && decs.length) && Array.isArray((m as any).attachments)) {
                                    try {
                                        const hit = (m as any).attachments.find((a:any)=> typeof a === 'string' && a.startsWith('decisions:'));
                                        if (hit) {
                                            const payload = hit.slice('decisions:'.length);
                                            try { const obj = JSON.parse(payload); if (Array.isArray(obj?.decisions) && obj.decisions.length) decs = obj.decisions; } catch {}
                                        }
                                    } catch {}
                                }
                                if (!(decs && decs.length)) {
                                    // Final UI-only fallback: infer a single decision from assistant content
                                    try {
                                        const txt = String(m.content || '');
                                        if (/\bwe\s+decided\b|\bdecided\s+to\b|\blet'?s\s+go\s+with\b|\bagreed\b|\bsettled\s+on\b/i.test(txt)) {
                                            decs = [{ title: txt.slice(0, 60), summary: txt.slice(0, 200), participants: [myId], decidedAtISO: m.createdAt }];
                                        }
                                    } catch {}
                                }
                                if (decs && decs.length) {
                                    // Decorate message locally so render sees metadata.decisions
                                    try {
                                        const decorated = { ...m, metadata: JSON.stringify({ ...(metaAny||{}), decisions: decs }) } as any;
                                        setMessages(prev => mergeDedupSort(prev, [decorated]));
                                    } catch {}
                                }
                            }
                        } catch {}
                        try { if (m?.senderId === 'assistant-bot') setAssistantPending(false); } catch {}
						try { await markDelivered(m.id, me.userId); } catch {}
						if (m.senderId !== me.userId) {
							try { await markRead(m.id, me.userId); } catch {}
							// foreground local notification when chat not focused
                            if (!isFocused) {
                                try {
                                    const { scheduleNotification } = await import('../utils/notify');
                                    await scheduleNotification('New message', m.content || 'New message received', { conversationId: cid });
                                } catch {}
                            }
						}
						// Auto-scroll latest into view when focused
						try {
							if (isFocused) {
								setTimeout(() => { try { listRef.current?.scrollToOffset?.({ offset: 0, animated: true }); } catch {} }, 0);
							}
						} catch {}
					},
						error: (_e: any) => {},
				});
				subRef.current = sub;
                // hydrate from cache next
				const cached = await AsyncStorage.getItem(`history:${cid}`);
				if (cached) {
					try {
                        const arr = JSON.parse(cached);
                        setMessages(arr);
                        try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:cache] items', Array.isArray(arr) ? arr.length : 0); } catch {}
						// ensure we show the latest message once on first load
						if (!didInitialScrollRef.current) {
							didInitialScrollRef.current = true;
							setTimeout(() => { try { listRef.current?.scrollToOffset?.({ offset: 0, animated: false }); } catch {} }, 0);
						}
					} catch {}
				}
                // Cross-check latest message via index for diagnostics
                try { const { getLatestMessageInConversation } = await import('../graphql/messages'); const latest = await getLatestMessageInConversation(cid); try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:latestCheck]', latest ? { id: latest.id, createdAt: latest.createdAt } : 'none'); } catch {} } catch {}
				// fetch history after subscription is active
                let pageSize = 50;
				let res: any = await listMessagesCompat(cid, pageSize);
				let items = res.items as any[];
				let syntheticUsed = false;
                try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:fetch] firstPage count', Array.isArray(items) ? items.length : 0, 'nextToken', res?.nextToken); } catch {}
				// Freshness retries: handle eventual consistency right after first message
				if (!items || items.length === 0) {
					for (let i = 0; i < 3 && (!items || items.length === 0); i++) {
						await new Promise(r => setTimeout(r, 300));
						try { const again: any = await listMessagesCompat(cid, pageSize); items = again.items || []; res = again; } catch {}
                        try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:fetch] retry', i+1, 'count', Array.isArray(items) ? items.length : 0); } catch {}
					}
				}
				// Final attempt: if still empty, try one more list with smaller limit to bust caches
                if (!items || items.length === 0) {
                    try { const alt: any = await listMessagesCompat(cid, 10); items = alt.items || []; res = alt; } catch {}
                    try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:fetch] finalAttempt count', Array.isArray(items) ? items.length : 0); } catch {}
                }
                // Synthetic fallback: if still empty, use conversation.lastMessage for initial render
                if (!items || items.length === 0) {
                    try {
                        const convRes: any = await getConversation(cid);
                        const c = convRes?.data?.getConversation;
                        if (c?.lastMessage && c?.lastMessageAt) {
                            const synthetic = {
                                id: `synthetic::${c.lastMessageAt}`,
                                conversationId: cid,
                                content: c.lastMessage,
                                attachments: [],
                                messageType: 'TEXT',
                                senderId: c.lastMessageSender || 'unknown',
                                metadata: null,
                                createdAt: c.lastMessageAt,
                                updatedAt: c.lastMessageAt,
                            } as any;
                            items = [synthetic];
							syntheticUsed = true;
                            try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:fetch] synthetic from conversation.lastMessage'); } catch {}
                        }
                    } catch {}
                }
				// Bounded backfill loop: if we only have synthetic or empty, retry list for a short window
				if (syntheticUsed || !items || items.length === 0) {
					const t0 = Date.now();
					for (let i = 0; i < 8 && (syntheticUsed || !items || items.length === 0); i++) { // ~3.5s max
						await new Promise(r => setTimeout(r, 450));
						try {
							const again: any = await listMessagesCompat(cid, pageSize);
							const got = again.items || [];
							try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:backfill] attempt', i+1, 'count', got.length); } catch {}
							if (got.length > 0) { items = got; res = again; syntheticUsed = false; break; }
						} catch {}
						if (Date.now() - t0 > 3800) break;
					}
					try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[chat:backfill]', syntheticUsed ? 'no-data' : 'success'); } catch {}
				}
                // Optional backfill disabled for simplicity; first page is sufficient for visibility
				setNextToken(res.nextToken);
                // Build user email map by harvesting metadata.email from fetched items
                try {
                    const metaMap: Record<string, string> = {};
                    for (const it of items) {
                        try {
                            const meta = (() => { try { return typeof it.metadata === 'string' ? JSON.parse(it.metadata) : (it.metadata || {}); } catch { return {}; } })();
                            const em = (meta && typeof meta.email === 'string') ? meta.email.trim() : '';
                            if (it.senderId && em) metaMap[it.senderId] = em;
                        } catch {}
                    }
                    if (Object.keys(metaMap).length) setUserIdToEmail(prev => ({ ...prev, ...metaMap }));
                } catch {}
                // Compute active participants from latest 50 messages
                try {
                    const latest = (items || []).slice(0, 50);
                    const ids = Array.from(new Set(latest.map((mm:any) => mm.senderId).filter(Boolean)));
                    setParticipantIds(ids);
                } catch {}
				// Decorate with basic status icon based on receipts for 1:1
				const decorated = await Promise.all(items.map(async (m: any) => {
					try {
						if (m.senderId === me.userId) {
                            const r: any = await getReceiptForMessageUser(m.id, otherUserResolved || otherUserId);
							const receipt = r?.data?.messageReadsByMessageIdAndUserId?.items?.[0];
							const state = receipt?.readAt ? 'read' : (receipt?.deliveredAt ? 'delivered' : 'sent');
							return { ...m, __status: state };
						}
					} catch {}
					return m;
				}));
				setMessages(prev => {
					const merged = mergeDedupSort(prev, decorated);
					AsyncStorage.setItem(`history:${cid}`, JSON.stringify(merged)).catch(() => {});
					return merged;
				});
				// ensure scrolled to latest if cache was empty
				try {
					if (!didInitialScrollRef.current) {
						didInitialScrollRef.current = true;
						setTimeout(() => { try { listRef.current?.scrollToOffset?.({ offset: 0, animated: false }); } catch {} }, 0);
					}
				} catch {}
				// mark delivered for fetched messages not sent by me
				try {
					for (const m of items) {
						if (m.senderId !== me.userId) {
							await markDelivered(m.id, me.userId);
						}
					}
				} catch {}
				// mark read for all fetched messages not sent by me (on open)
				try {
					for (const m of items) {
						if (m.senderId !== me.userId) {
							await markRead(m.id, me.userId);
						}
					}
				} catch {}
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
				// subscribe to conversation deleted events to navigate away if deleted elsewhere
				try {
					const delStart = subscribeConversationDeleted(cid);
					const delSub = delStart({ next: () => {
						try {
							if (navigation.canGoBack?.()) {
								navigation.goBack?.();
							} else {
								navigation.navigate?.('Conversations');
							}
						} catch {}
						try { showToast('Conversation was deleted'); } catch {}
					}, error: () => {} });
					deleteSubRef.current = delSub;
				} catch {}

                // drain outbox with retry/backoff (one-time on mount)
                const drainOnce = async () => {
                    if (!cid) return;
                    const cidVal = String(cid);
                    const outboxRaw = await AsyncStorage.getItem(`outbox:${cidVal}`);
					const outbox = outboxRaw ? JSON.parse(outboxRaw) : [];
					const remaining: any[] = [];
					const resolveEmail = async () => {
						try { if (myEmail) return myEmail; } catch {}
						try {
							const session: any = await fetchAuthSession();
							const claims: any = session?.tokens?.idToken?.payload || {};
							const tokenEmail = (claims?.email || '').trim();
							return tokenEmail || '';
						} catch { return ''; }
					};
					for (const job of outbox) {
						const attempts = job.attempts || 0;
						try {
							const emailToSend = await resolveEmail();
                            if (job.type === 'image' && job.imageUrl) {
                                await sendTextMessageCompat(cidVal, `[image] ${job.imageUrl}`, me.userId, emailToSend);
                            } else if (job.content) {
                                await sendTextMessageCompat(cidVal, job.content, me.userId, emailToSend);
							}
						} catch {
							job.attempts = attempts + 1;
							const delayMs = Math.min(30000, 1000 * Math.pow(2, attempts));
							job.nextTryAt = Date.now() + delayMs;
							remaining.push(job);
						}
					}
                    if (remaining.length) {
                        await AsyncStorage.setItem(`outbox:${cidVal}`, JSON.stringify(remaining));
                    } else {
                        await AsyncStorage.removeItem(`outbox:${cidVal}`);
					}
				};
				await drainOnce();
                // Periodic drainer with backoff + network/appstate triggers
                try {
                    const { ENABLE_OUTBOX_DRAINER } = getFlags();
                    if (ENABLE_OUTBOX_DRAINER) {
                        const tick = async () => {
                            try {
                                const state = await NetInfo.fetch();
                                const online = !(state.isConnected === false || state.isInternetReachable === false);
                                if (!online) return;
                                if (!cid) return;
                                const raw = await AsyncStorage.getItem(`outbox:${String(cid)}`);
                                const arr = raw ? JSON.parse(raw) : [];
                                const now = Date.now();
                                const ready = arr.filter((j: any) => !j.nextTryAt || j.nextTryAt <= now);
				if (ready.length) await drainOnce();
                            } catch {}
                        };
                        drainIntervalRef.current = setInterval(tick, 4000);
                        const unsubNet = NetInfo.addEventListener(() => { tick(); });
                        const onApp = (s: any) => { if (s === 'active') tick(); };
                        const subApp = AppState.addEventListener('change', onApp);
                        // store unsubscribers in refs to clean up
                        (drainIntervalRef as any).unsubNet = unsubNet;
                        (drainIntervalRef as any).subApp = subApp;
                    }
                } catch {}
				// Final ensure lastReadAt on entering chat
				try { await setMyLastRead(cid, me.userId, new Date().toISOString()); } catch {}
			} catch (e: any) {
				setError(e?.message ?? 'Failed to load chat');
			}
				// Load draft and presence when chat UX is enabled
				try {
					const { ENABLE_CHAT_UX } = getFlags();
					if (ENABLE_CHAT_UX) {
						try { const d = await AsyncStorage.getItem(`draft:${cid}`); if (d) setInput(d); } catch {}
						if (otherId) {
							try {
								const start = subscribeUserPresence(otherId);
								const sub = start({ next: (evt: any) => { try { const v = evt?.data?.onUpdateUser?.lastSeen; if (v) setOtherLastSeen(v); } catch {} }, error: () => {} });
								presenceSubRef.current = sub;
							} catch {}
						}
					}
				} catch {}
		})();
        return () => { subRef.current?.unsubscribe?.(); typingSubRef.current?.unsubscribe?.(); receiptsSubRef.current?.unsubscribe?.(); deleteSubRef.current?.unsubscribe?.(); presenceSubRef.current?.unsubscribe?.(); if (typingTimerRef.current) clearTimeout(typingTimerRef.current); try { if (drainIntervalRef.current) clearInterval(drainIntervalRef.current); } catch {}; try { (drainIntervalRef as any).unsubNet?.(); } catch {}; try { (drainIntervalRef as any).subApp?.remove?.(); } catch {}; };
	}, []);

	// Final trailing lastRead write on blur
	useEffect(() => {
		(async () => {
			if (!isFocused) {
				try {
					const me = await getCurrentUser();
					const cidNow = providedConversationId || (otherUserId ? conversationIdFor(me.userId, otherUserId) : undefined);
					if (cidNow) {
						await setMyLastRead(cidNow, me.userId, new Date().toISOString());
					}
				} catch {}
			}
			if (isFocused) {
				try {
					const me = await getCurrentUser();
					const cidNow = providedConversationId || (otherUserId ? conversationIdFor(me.userId, otherUserId) : undefined);
					if (cidNow) {
						await setMyLastRead(cidNow, me.userId, new Date().toISOString());
						// Always attempt to fetch the latest page when entering the chat
						if (!latestRefreshInFlightRef.current) {
							latestRefreshInFlightRef.current = true;
							try {
								const page: any = await listMessagesCompat(cidNow, 25);
								const newer = page.items || [];
								setNextToken(page.nextToken);
					setMessages(prev => {
						const merged = mergeDedupSort(prev, newer);
						AsyncStorage.setItem(`history:${cidNow}`, JSON.stringify(merged)).catch(() => {});
						// Rebuild active participants from latest 50
						try {
							const latest = merged.slice(0, 50);
							const ids = Array.from(new Set(latest.map((mm:any) => mm.senderId).filter(Boolean)));
							setParticipantIds(ids);
						} catch {}
						return merged;
					});
						// Mark delivered & read for page items not sent by me (on focus refresh)
						try {
							for (const m of newer) {
								if (m.senderId !== me.userId) {
									await markDelivered(m.id, me.userId);
									await markRead(m.id, me.userId);
								}
							}
						} catch {}
								// Ensure emails for any senders in this latest page
								try { await ensureEmails(newer.map((m:any)=>m.senderId).filter(Boolean)); } catch {}
							} catch {}
							finally { latestRefreshInFlightRef.current = false; }
						}
					}
				} catch {}
			}
		})();
	}, [isFocused]);

	const onSend = async () => {
		try {
			setError(null);
			const trimmed = input.trim();
			if (!trimmed) { return; }
			const me = await getCurrentUser();
			const cid = providedConversationId || conversationIdFor(me.userId, otherUserId);
			// Pre-send barrier: ensure participant records exist so recipients can read immediately
			try {
				const { listParticipantsForConversation, ensureParticipant } = await import('../graphql/conversations');
				try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[send:barrier] start', { cid }); } catch {}
				// Ensure me; if a direct chat, also ensure the other participant
				try { await ensureParticipant(cid, me.userId, 'MEMBER'); try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[send:barrier] ensured self'); } catch {} } catch {}
				try {
					const target = otherUserResolved || otherUserId;
					if (target) { await ensureParticipant(cid, target, 'MEMBER'); try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[send:barrier] ensured other', { target }); } catch {} }
				} catch {}
				const t0 = Date.now();
				let count = 0;
				for (let i = 0; i < 6; i++) { // ~1.2s max
					try {
						const r: any = await listParticipantsForConversation(cid, 100);
						const items = r?.data?.conversationParticipantsByConversationIdAndUserId?.items || [];
						count = items.length || 0;
						if (count >= 2) break;
					} catch {}
					await new Promise(res => setTimeout(res, 200));
				}
				const elapsed = Date.now() - t0;
				try {
					const { DEBUG_LOGS } = getFlags();
					if (DEBUG_LOGS) console.log(count >= 2 ? '[send:barrier] ok' : '[send:barrier] timeout', { count, ms: elapsed });
				} catch {}
			} catch {}
			const localId = generateLocalId('msg');
            // quiet start
			const optimistic: any = {
				id: localId,
				conversationId: cid,
				createdAt: new Date().toISOString(),
				senderId: me.userId,
				content: trimmed,
				messageType: 'TEXT',
				_localStatus: 'PENDING',
                metadata: JSON.stringify({ email: myEmail || '' }),
			};
			setMessages(prev => {
				// Dedup by id in case rapid sends race
				const next = [optimistic, ...prev.filter(m => m.id !== localId)];
				return next;
			});
			setInput('');
			setIsSendingMsg(true);
            try {
                try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[send:attempt]', { conversationId: cid, userId: me.userId, hasEmail: !!(myEmail||'') }); } catch {}
                const saved: any = await sendTextMessageCompat(cid, optimistic.content, me.userId, myEmail || '');
                try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[send:ok]', { id: saved?.id, createdAt: saved?.createdAt }); } catch {}
				// Opportunistic presence update on outbound send
				try { await updateLastSeen(me.userId); } catch {}
				// Update conversation preview so the list shows latest text
                try { const when = new Date().toISOString(); await updateConversationLastMessage(cid, optimistic.content, when, me.userId); } catch {}
				setMessages(prev => {
					const replaced = prev.map(m => (m.id === localId ? saved : m));
					// Guard against duplicate ids when backend echoes a message with same id
					const seen = new Set<string>();
					const dedup = [] as any[];
					for (const m of replaced) { if (!seen.has(m.id)) { seen.add(m.id); dedup.push(m); } }
					return dedup;
				});
                // quiet ok
            } catch (sendErr: any) {
                // quiet error logs
				try {
					const errMsg = (sendErr?.errors?.[0]?.message) || sendErr?.message || 'Send failed';
					setError(errMsg);
                    try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[send:err]', errMsg); } catch {}
				} catch {}
				const key = `outbox:${cid}`;
				const raw = await AsyncStorage.getItem(key);
				const outbox = raw ? JSON.parse(raw) : [];
				outbox.push({ type: 'text', content: optimistic.content, createdAt: optimistic.createdAt });
				await AsyncStorage.setItem(key, JSON.stringify(outbox));
			}
			const snapshot = (prev => [optimistic, ...prev])(messages);
			AsyncStorage.setItem(`history:${cid}`, JSON.stringify(snapshot)).catch(() => {});
            try { const { ENABLE_CHAT_UX } = getFlags(); if (ENABLE_CHAT_UX) await AsyncStorage.removeItem(`draft:${cid}`); } catch {}
			// Assistant hook: if this is an assistant conversation, ping the agent endpoint (non-blocking)
			try {
				const { ASSISTANT_ENABLED } = getFlags();
				if (ASSISTANT_ENABLED && (providedConversationId || '').startsWith('assistant::')) {
					const extra: any = Constants.expoConfig?.extra || (Constants as any).manifest?.extra || {};
					const base = (extra.ASSISTANT_ENDPOINT || '').replace(/\/$/, '');
					if (base) {
						const req = { requestId: localId, conversationId: cid, userId: me.userId, text: optimistic.content };
                        try {
                            const { DEBUG_LOGS } = getFlags();
                            if (DEBUG_LOGS) {
                                try { console.log('[assistant] POST', `${base}/agent/weekend-plan`, req); } catch {}
                            }
                            // Attach Cognito ID token so Lambda can call AppSync with the same JWT
                            let jwt: string | undefined = undefined;
                            try {
                                const session: any = await (await import('aws-amplify/auth')).fetchAuthSession();
                                jwt = session?.tokens?.idToken?.toString?.() || session?.tokens?.idToken?.toString?.call(session.tokens.idToken);
                            } catch {}
                            const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
                            const body = { ...req, ...(jwt ? { jwt } : {}), ...(tz ? { tz } : {}) } as any;
                            const res = await fetch(`${base}/agent/weekend-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                            // soft log network status in UI footer if non-200
                            if (!res.ok) {
                                try { setError(`assistant endpoint ${res.status}`); } catch {}
                                if (DEBUG_LOGS) {
                                    try { console.log('[assistant] POST status', res.status, await res.text().catch(()=>'')); } catch {}
                                }
                            }
                        } catch (e:any) {
                            try { setError('assistant endpoint unreachable'); } catch {}
                            try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[assistant] POST error', e?.message || e); } catch {}
                        }
                        setAssistantPending(true);
                        try { if (assistantTimerRef.current) clearTimeout(assistantTimerRef.current); } catch {}
                        assistantTimerRef.current = setTimeout(() => { try { setAssistantPending(false); } catch {} }, 8000);
					}
				}
			} catch {}
		} catch (e: any) {
			setError(e?.message ?? 'Send failed');
		}
		finally { setIsSendingMsg(false); }
	};


	const onChangeInput = async (text: string) => {
		setInput(text);
		try {
			const now = Date.now();
			if (now - lastTypingSentRef.current > 1200) {
				lastTypingSentRef.current = now;
				const me = await getCurrentUser();
				const cid = providedConversationId || conversationIdFor(me.userId, otherUserId);
				await sendTyping(cid, me.userId);
				// Opportunistic presence update on typing bursts (lightweight)
				try { await updateLastSeen(me.userId); } catch {}
			}
		} catch {}
		try {
			const { ENABLE_CHAT_UX } = getFlags();
			if (ENABLE_CHAT_UX) {
				const me = await getCurrentUser();
				const cid = providedConversationId || conversationIdFor(me.userId, otherUserId);
				await AsyncStorage.setItem(`draft:${cid}`, text);
			}
		} catch {}
	};

	return (
			<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
				<SafeAreaView edges={['top']} style={{ backgroundColor: theme.colors.surface }}>
				<View style={{ flexDirection: 'row', alignItems: 'center' }}>
					<TouchableOpacity
						onPress={() => {
							try {
								if (navigation.canGoBack?.()) {
									navigation.goBack?.();
								} else {
									navigation.navigate?.('Conversations');
								}
							} catch {}
						}}
						style={{ paddingHorizontal: 12, paddingVertical: 8 }}
						accessibilityLabel="Go back"
					>
						<Text style={{ color: theme.colors.primary, fontSize: 18 }}>←</Text>
					</TouchableOpacity>
                    <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={async () => {
                            try {
                                const { ENABLE_ADD_TO_GROUP } = getFlags();
                                if (!ENABLE_ADD_TO_GROUP) {
                                    const ids = Array.from(new Set([myId, ...participantIds].filter(Boolean)));
                                    if (ids.length) await ensureEmails(ids);
                                    setParticipantsVisible(true);
                                }
                            } catch {}
                        }}
                        accessibilityLabel="Chat info"
                    >
						<View style={{ paddingVertical: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
								<Text style={{ textAlign: 'center', fontWeight: '600', color: theme.colors.textPrimary }} numberOfLines={1}>
									{convName || (isGroup ? 'Group chat' : 'Chat')}
								</Text>
							</View>
							{(() => { const { ENABLE_CHAT_UX } = getFlags(); const sub = ENABLE_CHAT_UX && otherLastSeen ? (Date.now() - new Date(otherLastSeen).getTime() < 2*60*1000 ? 'Online' : (formatLastSeen(otherLastSeen) || undefined)) : undefined; return sub ? (
								<Text style={{ textAlign: 'center', color: theme.colors.textSecondary, fontSize: 12 }} numberOfLines={1}>{sub}</Text>
							) : null; })()}
						</View>
					</TouchableOpacity>
                        <TouchableOpacity
                            accessibilityLabel="Menu"
                            onPress={() => setMenuVisible(true)}
                            style={{ paddingHorizontal: 12, paddingVertical: 8, minHeight: 44, justifyContent: 'center' }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Text style={{ fontSize: 22, color: theme.colors.textPrimary }}>☰</Text>
                        </TouchableOpacity>
					</View>
				</SafeAreaView>
				{isTyping ? <Text style={{ paddingHorizontal: theme.spacing.md, color: theme.colors.muted }}>typing…</Text> : null}
				{(() => { try { const { ASSISTANT_ENABLED } = getFlags(); return ASSISTANT_ENABLED; } catch { return false; } })() && (providedConversationId || '').startsWith('assistant::') && assistantPending ? (
					<Text style={{ paddingHorizontal: theme.spacing.md, color: theme.colors.muted }}>Assistant is thinking…</Text>
            ) : null}
			<FlatList
				inverted
				ref={listRef}
				data={messages}
				keyExtractor={(item: any) => item.id}
				removeClippedSubviews
				initialNumToRender={20}
				windowSize={7}
				maxToRenderPerBatch={12}
				updateCellsBatchingPeriod={50}
				maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 60 }}
				onEndReachedThreshold={0.1}
				onScrollBeginDrag={() => { isUserDraggingRef.current = true; }}
				onMomentumScrollEnd={() => { isUserDraggingRef.current = false; }}
				onScroll={(e: any) => {
					try {
						const y = e?.nativeEvent?.contentOffset?.y ?? 0;
						isNearBottomRef.current = y <= 80;
					} catch {}
				}}
				onScrollEndDrag={async () => {
					isUserDraggingRef.current = false;
					try { const me = await getCurrentUser(); const cidNow = providedConversationId || conversationIdFor(me.userId, otherUserResolved || otherUserId); debouncedSetLastRead(cidNow, me.userId); } catch {}
				}}
				onEndReached={async () => {
					if (isLoadingMore || !nextToken) return;
					try {
						setIsLoadingMore(true);
                        const me = await getCurrentUser();
                        const cid = providedConversationId || conversationIdFor(me.userId, otherUserResolved || otherUserId);
                        const cidMore = providedConversationId || conversationIdFor(me.userId, otherUserResolved || otherUserId);
				const page: any = await listMessagesCompat(cidMore, 25, nextToken);
				const older = page.items || [];
				setNextToken(page.nextToken);
					setMessages(prev => {
						const next = mergeDedupSort(prev, older);
						AsyncStorage.setItem(`history:${cid}`, JSON.stringify(next)).catch(() => {});
						// Recompute active participants from latest 50
						try {
							const latest = next.slice(0, 50);
							const ids = Array.from(new Set(latest.map((mm:any) => mm.senderId).filter(Boolean)));
							setParticipantIds(ids);
						} catch {}
						return next;
					});
					} catch {}
					finally { setIsLoadingMore(false); }
				}}
				renderItem={({ item }: any) => (
					<View style={{ padding: 8, flexDirection: 'row', alignItems: 'flex-start', width: '100%' }}>
						{item.messageType === 'IMAGE' && item.attachments?.[0] ? (
							<Image
								source={{ uri: item.attachments[0] }}
								style={[{ width: 200, height: 200, borderRadius: 8 }, item.senderId !== myId ? { marginLeft: 'auto' } : null]}
							/>
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
                                <View style={[{ maxWidth: '88%', backgroundColor: item.senderId === myId ? theme.colors.bubbleMe : theme.colors.bubbleOther, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 10, marginVertical: 4 }, item.senderId !== myId ? { marginLeft: 'auto' } : null ]}>
								<Text style={{ color: theme.colors.textPrimary }}>
									{item.content} {item._localStatus ? `(${item._localStatus})` : ''}
									{item.__status ? ' ' : ''}
									{item.__status === 'sent' ? '✓' : null}
									{item.__status === 'delivered' ? <Text style={{ color: theme.colors.textSecondary }}>✓✓</Text> : null}
									{item.__status === 'read' ? <Text style={{ color: theme.colors.primary }}>✓✓</Text> : null}
								</Text>
                                            {(() => {
                                                const isMe = item.senderId === myId;
                                                const label = isMe ? 'you' : (userIdToEmail[item.senderId] || '');
                                                const edited = item.editedAt ? ' · edited' : '';
                                                const suffix = label ? ` · ${label}` : '';
                                                return (
                                                    <Text style={{ color: theme.colors.textSecondary, fontSize: 11, marginTop: 6 }} numberOfLines={1}>
                                                        {formatTimestamp(item.createdAt)}{edited}{suffix}
                                                    </Text>
                                                );
                                            })()}
							</View>
								</TouchableOpacity>
							)}
					{/* Avatars disabled per requirements */}
						</View>
				)}
			/>
			<Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
				<View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
					<View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '80%' }}>
						<Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Message info</Text>
						<Text style={{ color: theme.colors.textPrimary, marginBottom: theme.spacing.md }}>{infoText}</Text>
						<Button title="Close" onPress={() => setInfoVisible(false)} />
					</View>
				</View>
			</Modal>

            {/* Header menu modal */}
            <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
                <TouchableWithoutFeedback onPress={() => setMenuVisible(false)}>
                <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'flex-start', alignItems: 'flex-end' }}>
                </View>
                </TouchableWithoutFeedback>
                <View pointerEvents="box-none" style={{ position: 'absolute', top: 64, right: 12 }}>
                    <View style={{ marginTop: 64, marginRight: 12, backgroundColor: theme.colors.modal, padding: 8, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, minWidth: 200 }}>
                        {(() => { try { const { ENABLE_ADD_TO_GROUP } = getFlags(); return ENABLE_ADD_TO_GROUP; } catch { return false; } })() ? (
                        <TouchableOpacity
                            onPress={() => { setMenuVisible(false); setAddError(null); setAddInput(''); setAddVisible(true); }}
                            style={{ paddingVertical: 10, paddingHorizontal: 8 }}
                            accessibilityLabel="Add participant"
                        >
                            <Text style={{ color: theme.colors.textPrimary }}>Add Participant</Text>
                        </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                            onPress={() => {
                                setMenuVisible(false);
                                setRenameError(null);
                                setRenameInput(convName || '');
                                setRenameVisible(true);
                            }}
                            style={{ paddingVertical: 10, paddingHorizontal: 8 }}
                            accessibilityLabel="Rename conversation"
                        >
                            <Text style={{ color: theme.colors.textPrimary }}>Rename Conversation</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={async () => {
                                setMenuVisible(false);
                                try {
                                    const me = await getCurrentUser();
                                    const cid = providedConversationId || (otherUserId ? conversationIdFor(me.userId, otherUserId) : undefined);
                                    if (!cid) return;
                                    Alert.alert(
                                        'Delete conversation?',
                                        'This will delete the conversation for all users. This action cannot be undone.',
                                        [
                                            { text: 'Cancel', style: 'cancel' },
                                            {
                                                text: 'Delete', style: 'destructive', onPress: async () => {
                                                    try {
                                                        await deleteConversationById(cid);
                                                        try { await AsyncStorage.removeItem(`history:${cid}`); } catch {}
                                                        try { subRef.current?.unsubscribe?.(); } catch {}
                                                        try { typingSubRef.current?.unsubscribe?.(); } catch {}
                                                        try { receiptsSubRef.current?.unsubscribe?.(); } catch {}
                                                        try {
                                                            if (navigation.canGoBack?.()) {
                                                                navigation.goBack?.();
                                                            } else {
                                                                navigation.navigate?.('Conversations');
                                                            }
                                                        } catch {}
                                                        try { showToast('Conversation deleted'); } catch {}
                                                    } catch (e) {
                                                        setError((e as any)?.message || 'Delete failed');
                                                    }
                                                }
                                            }
                                        ]
                                    );
                                } catch {}
                            }}
                            style={{ paddingVertical: 10, paddingHorizontal: 8 }}
                            accessibilityLabel="Delete conversation"
                        >
                            <Text style={{ color: theme.colors.destructive }}>Delete Conversation</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Rename conversation modal */}
            <Modal visible={renameVisible} transparent animationType="fade" onRequestClose={() => { if (!renameBusy) setRenameVisible(false); }}>
                <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
                    <View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
                        <Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Rename conversation</Text>
                        <TextInput
                            placeholder="Conversation name (optional)"
                            value={renameInput}
                            onChangeText={setRenameInput}
                            style={{ borderWidth: 1, padding: theme.spacing.sm, backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border, borderRadius: theme.radii.md }}
                            autoCapitalize="sentences"
                            autoCorrect
                            returnKeyType="done"
                            editable={!renameBusy}
                            onSubmitEditing={async () => {
                                if (renameBusy) return;
                                try {
                                    setRenameBusy(true);
                                    setRenameError(null);
                                    const newName = (renameInput || '').trim();
                                    const oldName = convName;
                                    const cid = conversationId || (providedConversationId || '');
                                    if (!cid) { setRenameBusy(false); return; }
                                    // optimistic local update + handoff for list
                                    setConvName(newName);
                                    try { await AsyncStorage.setItem('handoff:conv-rename', JSON.stringify({ id: cid, name: newName })); } catch {}
                                    try {
                                        await updateConversationName(cid, newName);
                                        try { showToast('Name updated'); } catch {}
                                        setRenameVisible(false);
                                    } catch (e) {
                                        setConvName(oldName);
                                        setRenameError((e as any)?.message || 'Rename failed');
                                    } finally {
                                        setRenameBusy(false);
                                    }
                                } catch (e) {
                                    setRenameBusy(false);
                                    setRenameError((e as any)?.message || 'Rename failed');
                                }
                            }}
                        />
                        {renameError ? <Text style={{ color: theme.colors.danger, marginTop: theme.spacing.sm }}>{renameError}</Text> : null}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
                            <Button title={renameBusy ? 'Saving…' : 'Save'} onPress={async () => {
                                if (renameBusy) return;
                                try {
                                    setRenameBusy(true);
                                    setRenameError(null);
                                    const newName = (renameInput || '').trim();
                                    const oldName = convName;
                                    const cid = conversationId || (providedConversationId || '');
                                    if (!cid) { setRenameBusy(false); return; }
                                    setConvName(newName);
                                    try { await AsyncStorage.setItem('handoff:conv-rename', JSON.stringify({ id: cid, name: newName })); } catch {}
                                    try {
                                        await updateConversationName(cid, newName);
                                        try { showToast('Name updated'); } catch {}
                                        setRenameVisible(false);
                                    } catch (e) {
                                        setConvName(oldName);
                                        setRenameError((e as any)?.message || 'Rename failed');
                                    } finally {
                                        setRenameBusy(false);
                                    }
                                } catch (e) {
                                    setRenameBusy(false);
                                    setRenameError((e as any)?.message || 'Rename failed');
                                }
                            }} />
                            <Button title="Cancel" onPress={() => { if (!renameBusy) setRenameVisible(false); }} />
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Add participant modal (UID-only) */}
            {(() => { try { const { ENABLE_ADD_TO_GROUP } = getFlags(); return ENABLE_ADD_TO_GROUP; } catch { return false; } })() ? (
            <Modal visible={addVisible} transparent animationType="fade" onRequestClose={() => { if (!addBusy) setAddVisible(false); }}>
                <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
                    <View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
                        <Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Add participant</Text>
                        <TextInput
                            placeholder="Enter User ID"
                            value={addInput}
                            onChangeText={setAddInput}
                            style={{ borderWidth: 1, padding: theme.spacing.sm, backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border, borderRadius: theme.radii.md }}
                            autoCapitalize="none"
                            autoCorrect={false}
                            returnKeyType="go"
                            editable={!addBusy}
                            onSubmitEditing={async () => {
                                if (addBusy) return;
                                try {
                                    setAddBusy(true);
                                    setAddError(null);
                                    const uid = (addInput || '').trim();
                                    if (!uid || !conversationId) { setAddError('Missing input'); setAddBusy(false); return; }
                                    if (uid === 'assistant-bot' || uid.startsWith('assistant-')) { setAddError('Cannot add system user'); setAddBusy(false); return; }
                                    const { ensureParticipant } = await import('../graphql/conversations');
                                    await ensureParticipant(conversationId, uid, 'MEMBER');
                                    try { showToast('Participant added'); } catch {}
                                    setAddVisible(false);
                                    setAddInput('');
                                } catch (e) {
                                    setAddError((e as any)?.message || 'Add failed');
                                } finally {
                                    setAddBusy(false);
                                }
                            }}
                        />
                        {addError ? <Text style={{ color: theme.colors.danger, marginTop: theme.spacing.sm }}>{addError}</Text> : null}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
                            <Button title={addBusy ? 'Adding…' : 'Add'} onPress={async () => {
                                if (addBusy) return;
                                try {
                                    setAddBusy(true);
                                    setAddError(null);
                                    const uid = (addInput || '').trim();
                                    if (!uid || !conversationId) { setAddError('Missing input'); setAddBusy(false); return; }
                                    if (uid === 'assistant-bot' || uid.startsWith('assistant-')) { setAddError('Cannot add system user'); setAddBusy(false); return; }
                                    const { ensureParticipant } = await import('../graphql/conversations');
                                    await ensureParticipant(conversationId, uid, 'MEMBER');
                                    try { showToast('Participant added'); } catch {}
                                    setAddVisible(false);
                                    setAddInput('');
                                } catch (e) {
                                    setAddError((e as any)?.message || 'Add failed');
                                } finally {
                                    setAddBusy(false);
                                }
                            }} />
                            <Button title="Cancel" onPress={() => { if (!addBusy) setAddVisible(false); }} />
                        </View>
                    </View>
                </View>
            </Modal>
            ) : null}

            {/* Participants modal (disabled when add-to-group enabled) */}
            {(() => { try { const { ENABLE_ADD_TO_GROUP } = getFlags(); return !ENABLE_ADD_TO_GROUP; } catch { return true; } })() ? (
            <Modal visible={participantsVisible} transparent animationType="fade" onRequestClose={() => setParticipantsVisible(false)}>
                <View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
                    <View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
                        <Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Active Participant list</Text>
                        {(() => {
                            const ids = Array.from(new Set([myId, ...participantIds].filter(Boolean)));
                            return ids.map((uid) => {
                                const email = userIdToEmail[uid];
                                const showSpinner = !email;
                                if (showSpinner) {
                                    try { const { DEBUG_LOGS } = getFlags(); if (DEBUG_LOGS) console.log('[participants] awaiting email', uid); } catch {}
                                }
                                return (
                                    <View key={uid} style={{ paddingVertical: 6, minHeight: 22, flexDirection: 'row', alignItems: 'center' }}>
                                        {email ? (
                                            <Text style={{ color: theme.colors.textPrimary }}>{email}</Text>
                                        ) : (
                                            <ActivityIndicator size="small" color={theme.colors.muted} />
                                        )}
                                    </View>
                                );
                            });
                        })()}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing.md }}>
                            <Button title="Close" onPress={() => setParticipantsVisible(false)} />
                        </View>
                    </View>
                </View>
            </Modal>
            ) : null}
			{/* Recipes modal */}
			<Modal visible={recipesVisible} transparent animationType="fade" onRequestClose={() => setRecipesVisible(false)}>
				<View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
					<View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
						<Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Recipe suggestions</Text>
						{recipesItems.map((r:any, i:number) => (
							<View key={i} style={{ marginBottom: theme.spacing.sm }}>
								<Text style={{ fontWeight: '600', color: theme.colors.textPrimary }}>{r.title}</Text>
								<Text style={{ color: theme.colors.textSecondary }} numberOfLines={3}>{Array.isArray(r.ingredients) ? r.ingredients.slice(0,5).join(', ') : ''}</Text>
								<Text style={{ color: theme.colors.textSecondary }} numberOfLines={3}>{Array.isArray(r.steps) ? r.steps.slice(0,3).join('. ') : ''}</Text>
							</View>
						))}
						<View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
							<Button title="Close" onPress={() => setRecipesVisible(false)} />
						</View>
					</View>
				</View>
			</Modal>
            {/* Calendar picker modal */}
			<Modal visible={calPickVisible} transparent animationType="fade" onRequestClose={() => setCalPickVisible(false)}>
				<View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
					<View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
						<Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Choose calendar</Text>
                        {calChoices.map((c:any) => (
                            <TouchableOpacity key={c.id} onPress={async () => {
                                if (calBusy) return; setCalBusy(true);
                                try {
                                    await AsyncStorage.setItem('calendar:target', String(c.id));
                                    const evs = calPendingEventsRef.current || [];
                                    for (const e of evs) {
                                        try {
                                            await Calendar.createEventAsync(String(c.id), {
                                                title: e.title || 'Assistant Event',
                                                startDate: new Date(e.startISO || Date.now()),
                                                endDate: new Date(e.endISO || (Date.now() + 60*60*1000)),
                                                notes: e.notes || undefined,
                                            });
                                        } catch {}
                                    }
                                    try { showToast('Added to calendar'); } catch {}
                                    setCalPickVisible(false);
                                } catch (e) {
                                    try { showToast('Calendar not available in this build'); } catch {}
                                } finally { setCalBusy(false); calPendingEventsRef.current = null; }
							}} style={{ paddingVertical: theme.spacing.sm }}>
								<Text style={{ color: theme.colors.textPrimary }}>{c.title || c.name || c.id}</Text>
                            </TouchableOpacity>
                        ))}
						<View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing.md }}>
                            <Button title={calBusy ? 'Working…' : 'Cancel'} onPress={() => { if (!calBusy) setCalPickVisible(false); }} />
                        </View>
                    </View>
                </View>
            </Modal>
            {/* Decisions modal */}
			<Modal visible={decisionsVisible} transparent animationType="fade" onRequestClose={() => setDecisionsVisible(false)}>
				<View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
					<View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
						<Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Recent decisions</Text>
                        {decisionsItems.map((d:any, i:number) => (
							<View key={i} style={{ marginBottom: theme.spacing.sm }}>
								<Text style={{ fontWeight: '600', color: theme.colors.textPrimary }}>{d.title || 'Decision'}</Text>
								<Text style={{ color: theme.colors.textSecondary }} numberOfLines={3}>{d.summary || ''}</Text>
                                {(() => { try {
                                  const parts = Array.isArray(d.participants) ? d.participants : [];
                                  const me = myId;
                                  const display = parts.map((p:any) => p === me ? 'You' : p);
                                  const first = display.slice(0, 3);
                                  const more = Math.max(0, display.length - first.length);
									return <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>Participants: {first.join(', ')}{more ? ` +${more} more` : ''}</Text>;
                                } catch { return null; } })()}
								<Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>When: {d.decidedAtISO ? new Date(d.decidedAtISO).toLocaleString() : ''}</Text>
                            </View>
                        ))}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                            <Button title="Close" onPress={() => setDecisionsVisible(false)} />
                        </View>
                    </View>
                </View>
            </Modal>
			{error ? <Text style={{ color: theme.colors.danger }}>{error}</Text> : null}
			<View style={{ flexDirection: 'row', padding: theme.spacing.sm, gap: theme.spacing.sm, backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, borderTopWidth: 1 }}>
				<TextInput
					ref={messageInputRef}
					style={{ flex: 1, borderWidth: 1, padding: theme.spacing.sm, borderColor: theme.colors.border, backgroundColor: theme.colors.inputBackground, borderRadius: theme.radii.md }}
					value={input}
					onChangeText={onChangeInput}
					placeholder="Message"
					returnKeyType="send"
					blurOnSubmit={false}
					onSubmitEditing={() => { onSend(); messageInputRef.current?.focus?.(); }}
				/>
				<TouchableOpacity onPress={onSend} accessibilityLabel="Send message" style={{ backgroundColor: theme.colors.buttonPrimaryBg, paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' }}>
					<Text style={{ color: theme.colors.buttonPrimaryText, fontWeight: '600' }}>Send</Text>
				</TouchableOpacity>
			</View>

		</View>
	);
}

