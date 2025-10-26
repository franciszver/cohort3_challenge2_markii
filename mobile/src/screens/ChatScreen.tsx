import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, TextInput, Button, Text, Image, TouchableOpacity, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Calendar from 'expo-calendar';
import { formatTimestamp, formatLastSeen } from '../utils/time';
import { listMessagesCompat, sendTextMessageCompat, subscribeMessagesCompat, markDelivered, markRead, sendTyping, subscribeTyping, getReceiptForMessageUser, getMessageById } from '../graphql/messages';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { updateLastSeen, subscribeUserPresence } from '../graphql/users';
import { setMyLastRead, ensureDirectConversation, deleteConversationById, subscribeConversationDeleted, updateConversationLastMessage, listParticipantsForConversation, getConversation } from '../graphql/conversations';
import { showToast } from '../utils/toast';
import { debounce } from '../utils/debounce';
import { mergeDedupSort } from '../utils/messages';
import { generateLocalId } from '../utils/ids';
import { getFlags } from '../utils/flags';
import Constants from 'expo-constants';
import { getUserProfile } from '../graphql/profile';
import { getUserById, batchGetUsersCached } from '../graphql/users';
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
	const didInitialScrollRef = useRef(false);
	const isNearBottomRef = useRef(true);
	const isUserDraggingRef = useRef(false);
	const isFocused = useIsFocused();
const otherUserId = route.params?.otherUserSub as string;
	const providedConversationId = route.params?.conversationId as string | undefined;
	const [infoVisible, setInfoVisible] = useState(false);
	const [infoText, setInfoText] = useState<string>('');
const [otherProfile, setOtherProfile] = useState<any | null>(null);
const [myId, setMyId] = useState<string>('');
const [otherUserResolved, setOtherUserResolved] = useState<string | undefined>(undefined);
const [otherLastSeen, setOtherLastSeen] = useState<string | undefined>(undefined);
const [isSendingMsg, setIsSendingMsg] = useState(false);
const [assistantPending, setAssistantPending] = useState(false);
const assistantTimerRef = useRef<any>(null);
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

	// Debounced lastRead setter
	const debouncedSetLastRead = useRef(
		debounce(async (cid: string, uid: string) => {
			try { await setMyLastRead(cid, uid, new Date().toISOString()); } catch {}
		}, 500, { trailing: true })
	).current;

	useEffect(() => {
		(async () => {
			try {
                const me = await getCurrentUser();
                setMyId(me.userId);
                // Resolve my email from Cognito ID token, fallbacks to username/loginId
                try {
                    const session: any = await fetchAuthSession();
                    const claims: any = session?.tokens?.idToken?.payload || {};
                    const tokenEmail = (claims?.email || '').trim();
                    let fallbackEmail = '';
                    try { fallbackEmail = (me as any)?.username || (me as any)?.signInDetails?.loginId || ''; } catch {}
                    const finalEmail = tokenEmail || fallbackEmail;
                    if (finalEmail) setMyEmail(finalEmail);
                } catch {}
                let cid = providedConversationId || (otherUserId ? conversationIdFor(me.userId, otherUserId) : undefined);
				if (!cid) throw new Error('No conversation target');
                // Resolve other participant if not provided
                let otherId = otherUserId as string | undefined;
                try {
                    const partsRes: any = await listParticipantsForConversation(cid, 100);
                    const parts = partsRes?.data?.conversationParticipantsByConversationIdAndUserId?.items || [];
                    setParticipantIds(parts.map((p:any)=> p?.userId).filter(Boolean));
                    if (!otherId) {
                        const other = parts.find((p: any) => p?.userId && p.userId !== me.userId);
                        if (other?.userId) otherId = other.userId;
                    }
                    // Prefetch all participant emails for labeling
                    try {
                        const ids = Array.from(new Set(parts.map((p:any)=> p?.userId).filter(Boolean).concat(me.userId)));
                        const usersMap = await batchGetUsersCached(ids);
                        const map: Record<string, string> = {};
                        for (const uid of Object.keys(usersMap)) {
                            const u = (usersMap as any)[uid];
                            if (u?.email) map[uid] = u.email;
                        }
                        setUserIdToEmail(prev => ({ ...prev, ...map }));
                    } catch {}
                    // Load conversation metadata (name, group)
                    try {
                        const r: any = await getConversation(cid);
                        const c = r?.data?.getConversation;
                        if (c) { setConvName(c.name || ''); setIsGroup(!!c.isGroup); }
                    } catch {}
                } catch {}
                setOtherUserResolved(otherId);
                // Prefetch other participant's email for labeling
                try {
                    if (otherId) {
                        const urAny: any = await getUserById(otherId);
                        const u = urAny?.data?.getUser;
                        if (u?.email) setUserIdToEmail(prev => ({ ...prev, [otherId]: u.email }));
                    }
                } catch {}
                // Resolve other participant profile (flagged)
                try {
                    const { ENABLE_PROFILES } = getFlags();
                    if (ENABLE_PROFILES && otherId) {
                        const r: any = await getUserProfile(otherId);
                        const p = r?.data?.getUserProfile;
                        // Fallback to Users table for email if profile missing
                        if (!p || (!p.firstName && !p.lastName && !p.email)) {
                            try {
                                const ur: any = await getUserById(otherId);
                                const u = ur?.data?.getUser;
                                if (p) setOtherProfile({ ...p, email: p.email || u?.email });
                                else if (u) setOtherProfile({ userId: otherId, email: u.email });
                            } catch {
                                if (p) setOtherProfile(p);
                            }
                        } else {
                            setOtherProfile(p);
                        }
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
							return next;
						});
                        // Update email map for sender on the fly
                        try {
                            const sid = m?.senderId;
                            if (sid && !userIdToEmail[sid]) {
                                const r: any = await getUserById(sid);
                                const u = r?.data?.getUser;
                                if (u?.email) setUserIdToEmail(prev => ({ ...prev, [sid]: u.email }));
                            }
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
						setMessages(JSON.parse(cached));
						// ensure we show the latest message once on first load
						if (!didInitialScrollRef.current) {
							didInitialScrollRef.current = true;
							setTimeout(() => { try { listRef.current?.scrollToOffset?.({ offset: 0, animated: false }); } catch {} }, 0);
						}
					} catch {}
				}
				// fetch history after subscription is active
				let pageSize = 50;
				let res: any = await listMessagesCompat(cid, pageSize);
				let items = res.items as any[];
				// Freshness retries: handle eventual consistency right after first message
				if (!items || items.length === 0) {
					for (let i = 0; i < 3 && (!items || items.length === 0); i++) {
						await new Promise(r => setTimeout(r, 300));
						try { const again: any = await listMessagesCompat(cid, pageSize); items = again.items || []; res = again; } catch {}
					}
				}
				// Backfill all messages since my joinedAt, up to a sane cap
				try {
					const { getMyParticipantRecord } = await import('../graphql/conversations');
					const meNow = await getCurrentUser();
					const myPart: any = await getMyParticipantRecord(cid, meNow.userId);
					const joinedAt = myPart?.joinedAt ? new Date(myPart.joinedAt).getTime() : undefined;
					const cap = 200; // cap total backfill
					let nextToken = res.nextToken;
					while (nextToken && items.length < cap && joinedAt) {
						const more: any = await listMessagesCompat(cid, pageSize, nextToken);
						const older = (more.items || []) as any[];
						items = items.concat(older);
						nextToken = more.nextToken;
						const oldest = items[items.length - 1];
						if (oldest && new Date(oldest.createdAt).getTime() <= joinedAt) break;
					}
				} catch {}
				setNextToken(res.nextToken);
				// Build user email map for labeling bubbles
				try {
					const uniqueIds = Array.from(new Set(items.map((m:any) => m.senderId).filter(Boolean)));
					const usersMap = await batchGetUsersCached(uniqueIds);
					const map: Record<string, string> = {};
					for (const uid of Object.keys(usersMap)) {
						const u = (usersMap as any)[uid];
						if (u?.email) map[uid] = u.email;
					}
					setUserIdToEmail(prev => ({ ...prev, ...(myEmail ? { [me.userId]: myEmail } : {}), ...map }));
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
                // Periodic drainer with backoff + network/appstate triggers
                try {
                    const { ENABLE_OUTBOX_DRAINER } = getFlags();
                    if (ENABLE_OUTBOX_DRAINER) {
                        const tick = async () => {
                            try {
                                const state = await NetInfo.fetch();
                                const online = !(state.isConnected === false || state.isInternetReachable === false);
                                if (!online) return;
                                const raw = await AsyncStorage.getItem(`outbox:${cid}`);
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
			// Guard: ensure participant records exist before first send
			try {
				const { listParticipantsForConversation } = await import('../graphql/conversations');
				const start = Date.now();
				while (Date.now() - start < 1500) {
					try {
						const r: any = await listParticipantsForConversation(cid, 100);
						const items = r?.data?.conversationParticipantsByConversationIdAndUserId?.items || [];
						if (Array.isArray(items) && items.length >= 2) break;
					} catch {}
					await new Promise(res => setTimeout(res, 200));
				}
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
			};
			setMessages(prev => {
				// Dedup by id in case rapid sends race
				const next = [optimistic, ...prev.filter(m => m.id !== localId)];
				return next;
			});
			setInput('');
			setIsSendingMsg(true);
			try {
				const saved: any = await sendTextMessageCompat(cid, optimistic.content, me.userId);
				// Opportunistic presence update on outbound send
				try { await updateLastSeen(me.userId); } catch {}
				// Update conversation preview so the list shows latest text
				try { const when = new Date().toISOString(); await updateConversationLastMessage(cid, optimistic.content, when); } catch {}
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
					<TouchableOpacity style={{ flex: 1 }} onPress={() => setParticipantsVisible(true)} accessibilityLabel="Chat info">
						<View style={{ paddingVertical: 8 }}>
							<Text style={{ textAlign: 'center', fontWeight: '600', color: theme.colors.textPrimary }} numberOfLines={1}>
								{convName || (isGroup ? 'Group chat' : 'Chat')}
							</Text>
							{(() => { const { ENABLE_CHAT_UX } = getFlags(); const sub = ENABLE_CHAT_UX && otherLastSeen ? (Date.now() - new Date(otherLastSeen).getTime() < 2*60*1000 ? 'Online' : (formatLastSeen(otherLastSeen) || undefined)) : undefined; return sub ? (
								<Text style={{ textAlign: 'center', color: theme.colors.textSecondary, fontSize: 12 }} numberOfLines={1}>{sub}</Text>
							) : null; })()}
						</View>
					</TouchableOpacity>
						<TouchableOpacity
							onPress={async () => {
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
														// Navigate back to list (for local deleter)
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
							style={{ paddingRight: 12 }}
						>
							<Text style={{ color: '#ef4444', fontWeight: '600' }}>Delete</Text>
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
                                                const email = item.senderId === myId
                                                    ? (myEmail || userIdToEmail[myId] || '')
                                                    : (userIdToEmail[item.senderId] || '');
                                                const edited = item.editedAt ? ' · edited' : '';
                                                const suffix = email ? ` · ${email}` : '';
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

			{/* Participants modal */}
			<Modal visible={participantsVisible} transparent animationType="fade" onRequestClose={() => setParticipantsVisible(false)}>
				<View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
					<View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
						<Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Participants</Text>
						{(() => {
							const ids = Array.from(new Set([myId, ...participantIds].filter(Boolean)));
							return ids.map((uid) => (
								<View key={uid} style={{ paddingVertical: 6 }}>
									<Text style={{ color: theme.colors.textPrimary }}>{userIdToEmail[uid] || uid}</Text>
								</View>
							));
						})()}
						<View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: theme.spacing.md }}>
							<Button title="Close" onPress={() => setParticipantsVisible(false)} />
						</View>
					</View>
				</View>
			</Modal>
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
