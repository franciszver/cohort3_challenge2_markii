import * as Notifications from 'expo-notifications';
import { getFlags } from './flags';

const sentTimes: number[] = [];

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


