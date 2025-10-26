import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, TextInput, Button, Text, Image, TouchableOpacity, Modal, Alert } from 'react-native';
import * as Calendar from 'expo-calendar';
import { formatTimestamp, formatLastSeen } from '../utils/time';
import { listMessagesCompat, sendTextMessageCompat, subscribeMessagesCompat, markDelivered, markRead, sendTyping, subscribeTyping, getReceiptForMessageUser, getMessageById } from '../graphql/messages';
import { getCurrentUser } from 'aws-amplify/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ChatHeader from '../components/ChatHeader';
import { useIsFocused } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { updateLastSeen, subscribeUserPresence } from '../graphql/users';
import { setMyLastRead, ensureDirectConversation, deleteConversationById, subscribeConversationDeleted, updateConversationLastMessage, listParticipantsForConversation } from '../graphql/conversations';
import { showToast } from '../utils/toast';
import { debounce } from '../utils/debounce';
import { mergeDedupSort } from '../utils/messages';
import { generateLocalId } from '../utils/ids';
import { getFlags } from '../utils/flags';
import Constants from 'expo-constants';
import { getUserProfile } from '../graphql/profile';
import { getUserById } from '../graphql/users';
import Avatar from '../components/Avatar';
import { useTheme } from '../utils/theme';

function conversationIdFor(a: string, b: string) {
	return [a, b].sort().join('#');
}

export default function ChatScreen({ route, navigation }: any) {
	const theme = useTheme();
	const [messages, setMessages] = useState<any[]>([]);
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
                let cid = providedConversationId || (otherUserId ? conversationIdFor(me.userId, otherUserId) : undefined);
				if (!cid) throw new Error('No conversation target');
                // Resolve other participant if not provided
                let otherId = otherUserId as string | undefined;
                if (!otherId) {
                    try {
                        const partsRes: any = await listParticipantsForConversation(cid, 3);
                        const parts = partsRes?.data?.conversationParticipantsByConversationIdAndUserId?.items || [];
                        const other = parts.find((p: any) => p?.userId && p.userId !== me.userId);
                        if (other?.userId) otherId = other.userId;
                    } catch {}
                }
                setOtherUserResolved(otherId);
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
				// fetch latest page after subscription is active
				const res: any = await listMessagesCompat(cid, 25);
				const items = res.items;
				setNextToken(res.nextToken);
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
			<View style={{ flexDirection: 'row', alignItems: 'center' }}>
				<View style={{ flex: 1 }}>
					{(() => { const { ENABLE_CHAT_UX } = getFlags(); return (
						<ChatHeader
							username={otherUserId}
							online={ENABLE_CHAT_UX && otherLastSeen ? (Date.now() - new Date(otherLastSeen).getTime() < 2*60*1000) : undefined}
							subtitle={ENABLE_CHAT_UX && otherLastSeen ? (Date.now() - new Date(otherLastSeen).getTime() < 2*60*1000 ? 'Online' : (formatLastSeen(otherLastSeen) || undefined)) : undefined}
							profile={otherProfile ? { userId: otherProfile.userId, firstName: otherProfile.firstName, lastName: otherProfile.lastName, email: otherProfile.email, avatarColor: otherProfile.avatarColor } : undefined}
						/>
					); })()}
				</View>
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
            {isTyping ? <Text style={{ paddingHorizontal: 12, color: '#6b7280' }}>typing…</Text> : null}
            {(() => { try { const { ASSISTANT_ENABLED } = getFlags(); return ASSISTANT_ENABLED; } catch { return false; } })() && (providedConversationId || '').startsWith('assistant::') && assistantPending ? (
                <Text style={{ paddingHorizontal: 12, color: '#6b7280' }}>Assistant is thinking…</Text>
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
											{(() => { try { const { ENABLE_PROFILES } = getFlags(); return ENABLE_PROFILES; } catch { return false; } })() ? '' : `${item.senderId === myId ? 'Me' : item.senderId}: `}
											{item.content} {item._localStatus ? `(${item._localStatus})` : ''}
											{item.__status ? ' ' : ''}
											{item.__status === 'sent' ? '✓' : null}
											{item.__status === 'delivered' ? <Text style={{ color: theme.colors.textSecondary }}>✓✓</Text> : null}
											{item.__status === 'read' ? <Text style={{ color: theme.colors.primary }}>✓✓</Text> : null}
										</Text>
										<Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 4 }}>
											{formatTimestamp(item.createdAt)}{item.editedAt ? ' · edited' : ''}
										</Text>
									</View>
								</TouchableOpacity>
							)}
						{(() => { try { const { ENABLE_PROFILES } = getFlags(); return ENABLE_PROFILES; } catch { return false; } })() && item.senderId !== myId ? (
							<View style={{ marginLeft: 8 }}>
								<Avatar
									userId={item.senderId}
									firstName={item.senderId === (otherUserResolved || otherUserId) ? otherProfile?.firstName : undefined}
									lastName={item.senderId === (otherUserResolved || otherUserId) ? otherProfile?.lastName : undefined}
									email={item.senderId === (otherUserResolved || otherUserId) ? otherProfile?.email : undefined}
									color={item.senderId === (otherUserResolved || otherUserId) ? otherProfile?.avatarColor : undefined}
									size={24}
								/>
							</View>
						) : null}
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
			{/* Recipes modal */}
			<Modal visible={recipesVisible} transparent animationType="fade" onRequestClose={() => setRecipesVisible(false)}>
				<View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
					<View style={{ backgroundColor: 'white', padding: 16, borderRadius: 8, width: '85%' }}>
						<Text style={{ fontWeight: '600', marginBottom: 8 }}>Recipe suggestions</Text>
						{recipesItems.map((r:any, i:number) => (
							<View key={i} style={{ marginBottom: 8 }}>
								<Text style={{ fontWeight: '600' }}>{r.title}</Text>
								<Text style={{ color: '#6b7280' }} numberOfLines={3}>{Array.isArray(r.ingredients) ? r.ingredients.slice(0,5).join(', ') : ''}</Text>
								<Text style={{ color: '#6b7280' }} numberOfLines={3}>{Array.isArray(r.steps) ? r.steps.slice(0,3).join('. ') : ''}</Text>
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
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
                    <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 8, width: '85%' }}>
                        <Text style={{ fontWeight: '600', marginBottom: 8 }}>Choose calendar</Text>
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
                            }} style={{ paddingVertical: 8 }}>
                                <Text style={{ color: '#111827' }}>{c.title || c.name || c.id}</Text>
                            </TouchableOpacity>
                        ))}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                            <Button title={calBusy ? 'Working…' : 'Cancel'} onPress={() => { if (!calBusy) setCalPickVisible(false); }} />
                        </View>
                    </View>
                </View>
            </Modal>
            {/* Decisions modal */}
            <Modal visible={decisionsVisible} transparent animationType="fade" onRequestClose={() => setDecisionsVisible(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
                    <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 8, width: '85%' }}>
                        <Text style={{ fontWeight: '600', marginBottom: 8 }}>Recent decisions</Text>
                        {decisionsItems.map((d:any, i:number) => (
                            <View key={i} style={{ marginBottom: 8 }}>
                                <Text style={{ fontWeight: '600' }}>{d.title || 'Decision'}</Text>
                                <Text style={{ color: '#6b7280' }} numberOfLines={3}>{d.summary || ''}</Text>
                                {(() => { try {
                                  const parts = Array.isArray(d.participants) ? d.participants : [];
                                  const me = myId;
                                  const display = parts.map((p:any) => p === me ? 'You' : p);
                                  const first = display.slice(0, 3);
                                  const more = Math.max(0, display.length - first.length);
                                  return <Text style={{ color: '#6b7280', fontSize: 12 }}>Participants: {first.join(', ')}{more ? ` +${more} more` : ''}</Text>;
                                } catch { return null; } })()}
                                <Text style={{ color: '#6b7280', fontSize: 12 }}>When: {d.decidedAtISO ? new Date(d.decidedAtISO).toLocaleString() : ''}</Text>
                            </View>
                        ))}
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                            <Button title="Close" onPress={() => setDecisionsVisible(false)} />
                        </View>
                    </View>
                </View>
            </Modal>
			{error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
			<View style={{ flexDirection: 'row', padding: 8, gap: 8, backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, borderTopWidth: 1 }}>
				<TextInput
					ref={messageInputRef}
					style={{ flex: 1, borderWidth: 1, padding: 10, borderColor: theme.colors.border, backgroundColor: 'white', borderRadius: 8 }}
					value={input}
					onChangeText={onChangeInput}
					placeholder="Message"
					returnKeyType="send"
					blurOnSubmit={false}
					onSubmitEditing={() => { onSend(); messageInputRef.current?.focus?.(); }}
				/>
				<TouchableOpacity onPress={onSend} accessibilityLabel="Send message" style={{ backgroundColor: '#F2EFEA', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' }}>
					<Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Send</Text>
				</TouchableOpacity>
			</View>

		</View>
	);
}
