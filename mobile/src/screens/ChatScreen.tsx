import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, TextInput, Button, Text, Image, TouchableOpacity, TouchableWithoutFeedback, Modal, Alert, ActivityIndicator, ScrollView } from 'react-native';
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
import { setMyLastRead, ensureDirectConversation, deleteConversationById, subscribeConversationDeleted, updateConversationLastMessage, getConversation, updateConversationName } from '../graphql/conversations';
import { showToast } from '../utils/toast';
import { debounce } from '../utils/debounce';
import { mergeDedupSort } from '../utils/messages';
import { generateLocalId } from '../utils/ids';
import { getFlags } from '../utils/flags';
import Constants from 'expo-constants';
import { useTheme } from '../utils/theme';
import { preloadNicknames, setNickname as setNicknameUtil, getAllNicknames } from '../utils/nicknames';

function conversationIdFor(a: string, b: string) {
	return [a, b].sort().join('#');
}

export default function ChatScreen({ route, navigation }: any) {
	const theme = useTheme();
	const [messages, setMessages] = useState<any[]>([]);
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
    const [availableContacts, setAvailableContacts] = useState<Array<{ userId: string; displayName: string }>>([]);
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
	const prevParticipantCountRef = useRef(0);
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
// Nickname modal state
const [nicknameVisible, setNicknameVisible] = useState(false);
const [nicknameInput, setNicknameInput] = useState('');
const [nicknameTargetId, setNicknameTargetId] = useState<string | null>(null);
const [nicknames, setNicknames] = useState<Record<string, string>>({});

	// Load nicknames from AsyncStorage
	async function loadNicknames() {
		try {
			await preloadNicknames();
			const allNicknames = await import('../utils/nicknames').then(m => m.getAllNicknames());
			setNicknames(await allNicknames);
		} catch (e) {
			console.warn('[chat] Failed to load nicknames:', e);
		}
	}

	// Load available contacts for "Add Participant" modal
	async function loadAvailableContacts() {
		try {
			await preloadNicknames();
			const nicknames = await getAllNicknames();
			const me = await getCurrentUser();
			
		// Collect all known userIds from cached conversations
		const knownUserIds = new Set<string>();
		const allKeys = await AsyncStorage.getAllKeys();
		
		// Helper to validate if string looks like a real userId (UUID-like format)
		const isValidUserId = (id: string): boolean => {
			if (!id || id.length < 10) return false;
			// UserIds should contain dashes and be reasonably long (UUIDs/GUIDs)
			if (!id.includes('-')) return false;
			// Exclude common non-userId values
			const invalid = ['system', 'unknown', 'deleted', 'anonymous', 'guest', 'admin'];
			if (invalid.includes(id.toLowerCase())) return false;
			return true;
		};
		
		// Scan message history for userIds
		for (const key of allKeys) {
			if (key.startsWith('history:')) {
				try {
					const cached = await AsyncStorage.getItem(key);
					if (cached) {
						const messages = JSON.parse(cached);
						if (Array.isArray(messages)) {
							messages.forEach((msg: any) => {
								if (msg.senderId && 
									msg.senderId !== me.userId && 
									msg.senderId !== 'assistant-bot' && 
									!msg.senderId.startsWith('assistant-') &&
									isValidUserId(msg.senderId)) {
									knownUserIds.add(msg.senderId);
								}
							});
						}
					}
				} catch {}
			}
		}
			
			// Build contact list
			const contacts: Array<{ userId: string; displayName: string }> = [];
			
			// Get current participants to filter them out
			const currentParticipants = new Set([myId, ...participantIds]);
			
			// Add all users with nicknames (not in current conversation, only valid userIds)
			for (const [userId, nickname] of Object.entries(nicknames)) {
				if (!currentParticipants.has(userId) && 
					userId !== 'assistant-bot' && 
					!userId.startsWith('assistant-') &&
					isValidUserId(userId)) {
					contacts.push({
						userId,
						displayName: `${nickname} (${userId.slice(0, 11)}${userId.length > 11 ? '...' : ''})`
					});
				}
			}
			
			// Add known users without nicknames (not in current conversation)
			for (const userId of knownUserIds) {
				if (!nicknames[userId] && !currentParticipants.has(userId)) {
					contacts.push({
						userId,
						displayName: userId.length > 14 ? `${userId.slice(0, 14)}...` : userId
					});
				}
			}
			
			// Sort alphabetically
			contacts.sort((a, b) => a.displayName.localeCompare(b.displayName));
			
			setAvailableContacts(contacts);
		} catch (e) {
			console.warn('[chat] Failed to load available contacts:', e);
		}
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
				// Load nicknames early
				await loadNicknames();
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

	// Track participant count transitions and show system message when moving to multi-user
	useEffect(() => {
		const currentCount = participantIds.length;
		const prevCount = prevParticipantCountRef.current;
		
		// Transition from solo (≤2) to multi-user (>2)
		if (prevCount > 0 && prevCount <= 2 && currentCount > 2) {
			const isAssistantConvo = (providedConversationId || '').startsWith('assistant::');
			if (isAssistantConvo) {
				const systemMsg = {
					id: `system-transition-${Date.now()}`,
					content: "💡 Now that others joined, use @Ai to ask assistant",
					senderId: 'system',
					createdAt: new Date().toISOString(),
					messageType: 'TEXT',
					_isSystemMsg: true,
				};
				setMessages(prev => [systemMsg, ...prev]);
			}
		}
		
		// Update ref for next check
		prevParticipantCountRef.current = currentCount;
	}, [participantIds.length, providedConversationId]);

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
			
			// Solo/multi-user detection for @Ai triggering
			const isMultiUser = participantIds.length > 2;
			const isAiMention = /^@ai\b/i.test(trimmed);
			const isAssistantConvo = (() => { try { const { ASSISTANT_ENABLED } = getFlags(); return ASSISTANT_ENABLED && (providedConversationId || '').startsWith('assistant::'); } catch { return false; } })();
			
			let messageText = trimmed;
			let shouldTriggerAssistant = false;
			
			if (isAssistantConvo) {
				if (isMultiUser) {
					// Multi-user: require @Ai, keep prefix
					shouldTriggerAssistant = isAiMention;
				} else {
					// Solo: always trigger, strip @Ai if present
					shouldTriggerAssistant = true;
					if (isAiMention) {
						messageText = trimmed.replace(/^@ai\s*/i, '');
					}
				}
			}
			
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
				content: messageText,
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
			// Assistant hook: if this is an assistant conversation and shouldTriggerAssistant, ping the agent endpoint (non-blocking)
			try {
				if (shouldTriggerAssistant) {
					const extra: any = Constants.expoConfig?.extra || (Constants as any).manifest?.extra || {};
					const base = (extra.ASSISTANT_ENDPOINT || '').replace(/\/$/, '');
					if (base) {
						// Send original trimmed text to assistant for full context
						const req = { requestId: localId, conversationId: cid, userId: me.userId, text: trimmed };
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
				<Text style={{ paddingHorizontal: theme.spacing.md, color: theme.colors.muted }}>AI is responding…</Text>
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
						{item._isSystemMsg ? (
							<View style={{ width: '100%', alignItems: 'center', paddingVertical: 8 }}>
								<Text style={{ color: theme.colors.textSecondary, fontSize: 13, textAlign: 'center', fontStyle: 'italic' }}>
									{item.content}
								</Text>
							</View>
						) : item.messageType === 'IMAGE' && item.attachments?.[0] ? (
							<Image
								source={{ uri: item.attachments[0] }}
								style={[{ width: 200, height: 200, borderRadius: 8 }, item.senderId === myId ? { alignSelf: 'flex-end' } : null]}
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
								}} style={{ width: '100%' }}>
                                <View style={[{ maxWidth: '95%', backgroundColor: item.senderId === myId ? theme.colors.bubbleMe : theme.colors.bubbleOther, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, padding: 10, marginVertical: 4, alignSelf: item.senderId === myId ? 'flex-end' : 'flex-start' }]}>
								<Text style={{ color: theme.colors.textPrimary }}>
									{item.content} {item._localStatus ? `(${item._localStatus})` : ''}
									{item.__status ? ' ' : ''}
									{item.__status === 'sent' ? '✓' : null}
									{item.__status === 'delivered' ? <Text style={{ color: theme.colors.textSecondary }}>✓✓</Text> : null}
									{item.__status === 'read' ? <Text style={{ color: theme.colors.primary }}>✓✓</Text> : null}
								</Text>
                                            {(() => {
                                                const isMe = item.senderId === myId;
                                                const displayName = isMe ? 'you' : (nicknames[item.senderId] || item.senderId);
                                                const edited = item.editedAt ? ' · edited' : '';
                                                const isMultiUser = participantIds.length > 2;
                                                const isAiMention = /^@ai\b/i.test(String(item.content || ''));
                                                const showAiBadge = isMultiUser && isAiMention;
                                                const aiBadge = showAiBadge ? ' → AI' : '';
                                                return (
                                                    <View style={{ marginTop: 6 }}>
                                                        <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>
                                                            {formatTimestamp(item.createdAt)}{edited}{aiBadge}
                                                        </Text>
                                                        <TouchableOpacity 
                                                            onLongPress={() => {
                                                                if (!isMe && item.senderId) {
                                                                    setNicknameTargetId(item.senderId);
                                                                    setNicknameInput(nicknames[item.senderId] || '');
                                                                    setNicknameVisible(true);
                                                                }
                                                            }}
                                                            activeOpacity={isMe ? 1.0 : 0.6}
                                                        >
                                                            <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>
                                                                {displayName}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    </View>
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
                            onPress={async () => { 
                                setMenuVisible(false); 
                                setAddError(null); 
                                setAddInput(''); 
                                await loadAvailableContacts();
                                setAddVisible(true); 
                            }}
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
                    <View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%', maxHeight: '80%' }}>
                        <Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Add participant</Text>
                        
                        {availableContacts.length > 0 && (
                            <>
                                <Text style={{ marginBottom: 4, color: theme.colors.textSecondary, fontSize: 12 }}>Available Contacts (tap to add)</Text>
                                <ScrollView style={{ maxHeight: 180, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface }}>
                                    {availableContacts.map((contact) => (
                                        <TouchableOpacity
                                            key={contact.userId}
                                            onPress={async () => {
                                                if (addBusy) return;
                                                try {
                                                    setAddBusy(true);
                                                    setAddError(null);
                                                    const { ensureParticipant } = await import('../graphql/conversations');
                                                    await ensureParticipant(conversationId, contact.userId, 'MEMBER');
                                                    try { showToast('Participant added'); } catch {}
                                                    setAddVisible(false);
                                                } catch (e) {
                                                    setAddError((e as any)?.message || 'Add failed');
                                                } finally {
                                                    setAddBusy(false);
                                                }
                                            }}
                                            style={{ padding: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border, minHeight: 44, justifyContent: 'center' }}
                                        >
                                            <Text style={{ color: theme.colors.textPrimary }} numberOfLines={1}>
                                                {contact.displayName}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                            </>
                        )}
                        
                        <Text style={{ marginBottom: 4, color: theme.colors.textSecondary, fontSize: 12 }}>Or enter User ID manually</Text>
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
                        <Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Active Participants</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: theme.spacing.md }}>Long-press to set nickname</Text>
                        {(() => {
                            const ids = Array.from(new Set([myId, ...participantIds].filter(Boolean)));
                            return ids.map((uid) => {
                                const isMe = uid === myId;
                                const displayName = isMe ? 'You' : (nicknames[uid] || uid);
                                return (
                                    <TouchableOpacity 
                                        key={uid} 
                                        style={{ paddingVertical: 8, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                                        onLongPress={() => {
                                            if (!isMe) {
                                                setNicknameTargetId(uid);
                                                setNicknameInput(nicknames[uid] || '');
                                                setParticipantsVisible(false);
                                                setNicknameVisible(true);
                                            }
                                        }}
                                        activeOpacity={isMe ? 1.0 : 0.6}
                                    >
                                        <Text style={{ color: theme.colors.textPrimary, flex: 1 }} numberOfLines={1}>{displayName}</Text>
                                        {!isMe && <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>Hold to edit</Text>}
                                    </TouchableOpacity>
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
			{/* Nickname editor modal */}
			<Modal visible={nicknameVisible} transparent animationType="fade" onRequestClose={() => setNicknameVisible(false)}>
				<View style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center', alignItems: 'center' }}>
					<View style={{ backgroundColor: theme.colors.modal, padding: theme.spacing.lg, borderRadius: theme.radii.lg, width: '85%' }}>
						<Text style={{ fontWeight: '600', marginBottom: theme.spacing.sm, color: theme.colors.textPrimary }}>Set Nickname</Text>
						<Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: theme.spacing.sm }}>For user: {nicknameTargetId}</Text>
						<TextInput
							placeholder="Enter nickname (leave empty to clear)"
							value={nicknameInput}
							onChangeText={setNicknameInput}
							style={{ borderWidth: 1, padding: theme.spacing.sm, backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border, borderRadius: theme.radii.md, color: theme.colors.textPrimary, marginBottom: theme.spacing.md }}
							autoCapitalize="words"
							autoCorrect={false}
							returnKeyType="done"
							onSubmitEditing={async () => {
								if (!nicknameTargetId) return;
								try {
									await setNicknameUtil(nicknameTargetId, nicknameInput.trim());
									await loadNicknames();
									setNicknameVisible(false);
									showToast(nicknameInput.trim() ? 'Nickname saved' : 'Nickname cleared');
								} catch (e) {
									console.warn('[nickname] Save failed:', e);
									showToast('Failed to save nickname');
								}
							}}
						/>
						<View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.spacing.sm }}>
							<Button title="Clear" onPress={async () => {
								if (!nicknameTargetId) return;
								try {
									await setNicknameUtil(nicknameTargetId, '');
									await loadNicknames();
									setNicknameVisible(false);
									showToast('Nickname cleared');
								} catch (e) {
									console.warn('[nickname] Clear failed:', e);
									showToast('Failed to clear nickname');
								}
							}} />
							<Button title="Save" onPress={async () => {
								if (!nicknameTargetId) return;
								try {
									await setNicknameUtil(nicknameTargetId, nicknameInput.trim());
									await loadNicknames();
									setNicknameVisible(false);
									showToast(nicknameInput.trim() ? 'Nickname saved' : 'Nickname cleared');
								} catch (e) {
									console.warn('[nickname] Save failed:', e);
									showToast('Failed to save nickname');
								}
							}} />
							<Button title="Cancel" onPress={() => setNicknameVisible(false)} />
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
					placeholder={(() => {
						const isAssistantConvo = (providedConversationId || '').startsWith('assistant::');
						const isMultiUser = participantIds.length > 2;
						return isAssistantConvo && isMultiUser ? "@Ai for assistant" : "Message";
					})()}
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

