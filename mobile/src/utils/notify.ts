import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { getFlags } from './flags';

const sentTimes: number[] = [];
let activeConversationId: string | null = null;

// Track which conversation is currently being viewed
export function setActiveConversation(conversationId: string) {
  activeConversationId = conversationId;
}

export function clearActiveConversation() {
  activeConversationId = null;
}

export function getActiveConversation(): string | null {
  return activeConversationId;
}

// Clear active conversation when app goes to background
AppState.addEventListener('change', (state) => {
  if (state === 'background' || state === 'inactive') {
    clearActiveConversation();
  }
});

export function canSendNotificationNow(): boolean {
  try {
    const { NOTIFY_RATE_LIMIT_PER_MINUTE } = getFlags();
    const windowMs = 60 * 1000;
    const cutoff = Date.now() - windowMs;
    while (sentTimes.length && sentTimes[0] < cutoff) sentTimes.shift();
    return sentTimes.length < NOTIFY_RATE_LIMIT_PER_MINUTE;
  } catch {
    return true;
  }
}

export async function scheduleNotification(title: string, body: string, data?: Record<string, any>) {
  try {
    const { ENABLE_NOTIFICATIONS_UX } = getFlags();
    if (!ENABLE_NOTIFICATIONS_UX) {
      await Notifications.scheduleNotificationAsync({ content: { title, body, data }, trigger: null });
      return;
    }
    if (!canSendNotificationNow()) return;
    sentTimes.push(Date.now());
    await Notifications.scheduleNotificationAsync({ content: { title, body, data }, trigger: null });
  } catch {}
}


