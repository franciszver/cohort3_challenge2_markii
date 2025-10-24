import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, TextInput, Button, Text, Image, TouchableOpacity, Modal, Alert } from 'react-native';
import { formatTimestamp, formatLastSeen } from '../utils/time';
import { listMessagesCompat, sendTextMessageCompat, subscribeMessagesCompat, markDelivered, markRead, sendTyping, subscribeTyping, getReceiptForMessageUser } from '../graphql/messages';
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
	const [imageUrl, setImageUrl] = useState('');
	const listRef = useRef<any>(null);
	const messageInputRef = useRef<any>(null);
	const imageInputRef = useRef<any>(null);
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
const [isSendingImg, setIsSendingImg] = useState(false);
const [assistantPending, setAssistantPending] = useState(false);
const assistantTimerRef = useRef<any>(null);

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
                            const body = { ...req, ...(jwt ? { jwt } : {}) } as any;
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

			const onSendImage = async () => {
		try {
			setError(null);
			const me = await getCurrentUser();
			const cid = providedConversationId || conversationIdFor(me.userId, otherUserId);
			const url = imageUrl.trim();
			if (!url) { return; }
			const localId = generateLocalId('img');
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
			setIsSendingImg(true);
			try {
				// For MVP, send the URL as content reference; uploading to S3 can be added later
				const saved: any = await sendTextMessageCompat(cid, optimistic.content, me.userId);
				try {} catch {}
				setMessages(prev => prev.map(m => (m.id === localId ? saved : m)));
			} catch (sendErr) {
				try {} catch {}
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
		finally { setIsSendingImg(false); }
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
		<View style={{ flex: 1 }}>
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
						<View style={{ padding: 8, flexDirection: 'row', alignItems: 'flex-start' }}>
                            {(() => { try { const { ENABLE_PROFILES } = getFlags(); return ENABLE_PROFILES; } catch { return false; } })() && item.senderId !== myId ? (
								<View style={{ marginRight: 8 }}>
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
                                        {(() => { try { const { ENABLE_PROFILES } = getFlags(); return ENABLE_PROFILES; } catch { return false; } })() ? '' : `${item.senderId === myId ? 'Me' : item.senderId}: `}
										{item.content} {item._localStatus ? `(${item._localStatus})` : ''}
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
				<TextInput
					ref={messageInputRef}
					style={{ flex: 1, borderWidth: 1, padding: 8 }}
					value={input}
					onChangeText={onChangeInput}
					placeholder="Message"
					returnKeyType="send"
					blurOnSubmit={false}
					onSubmitEditing={() => { onSend(); messageInputRef.current?.focus?.(); }}
				/>
				<Button title="Send" onPress={onSend} />
			</View>
			<View style={{ flexDirection: 'row', padding: 8, gap: 8 }}>
				<TextInput
					ref={imageInputRef}
					style={{ flex: 1, borderWidth: 1, padding: 8 }}
					value={imageUrl}
					onChangeText={setImageUrl}
					placeholder="Image URL"
					autoCapitalize="none"
					returnKeyType="send"
					blurOnSubmit={false}
					onSubmitEditing={() => { onSendImage(); imageInputRef.current?.focus?.(); }}
				/>
				<Button title="Send Image" onPress={onSendImage} />
			</View>
		</View>
	);
}
