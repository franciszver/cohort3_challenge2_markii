import Constants from 'expo-constants';

type Flags = {
  DEBUG_LOGS: boolean;
  ENABLE_INTROSPECTION: boolean;
  ENABLE_PROFILES: boolean;
  ENABLE_CONVERSATION_LIST_UX: boolean;
  ENABLE_CHAT_UX: boolean;
  ENABLE_ADD_TO_GROUP: boolean;
  ENABLE_UNREAD_BADGE: boolean;
  ENABLE_AUTH_UX: boolean;
  ENABLE_NOTIFICATIONS_UX: boolean;
  ENABLE_THEME: boolean;
  // New granular feature flags (default ON per product guidance)
  ENABLE_THEME_SKY: boolean;
  ENABLE_AUTH_GRADIENT_BG: boolean;
  ENABLE_AUTH_VERIFICATION_INLINE: boolean;
  ENABLE_FORGOT_LINEAR: boolean;
  ENABLE_AUTH_ERROR_MAP: boolean;
  ENABLE_OFFLINE_BANNER: boolean;
  ENABLE_ERROR_BOUNDARY_SCREEN: boolean;
  ENABLE_BUTTON_SPINNERS_PRIMARY: boolean;
  ENABLE_MESSAGE_SKELETONS: boolean;
  ENABLE_OUTBOX_DRAINER: boolean;
  ENABLE_CONV_INFINITE_SCROLL: boolean;
  ENABLE_MESSAGES_PULL_TO_REFRESH: boolean;
  PRESENCE_HEARTBEAT_MS: number;
  NOTIFY_RATE_LIMIT_PER_MINUTE: number;
  // Assistant MVP flags
  ASSISTANT_ENABLED: boolean;
  ASSISTANT_CALENDAR_ENABLED: boolean;
  ASSISTANT_CALENDAR_READ_ENABLED: boolean;
  ASSISTANT_DECISIONS_ENABLED: boolean;
  ASSISTANT_PRIORITY_ENABLED: boolean;
  ASSISTANT_RSVP_ENABLED: boolean;
  ASSISTANT_DEADLINES_ENABLED: boolean;
  ASSISTANT_CONFLICTS_ENABLED: boolean;
  ASSISTANT_GROUP_ENABLED: boolean;
  ENABLE_CONVERSATION_LIST_CACHE: boolean;
};

let _flags: Flags | null = null;

export function getFlags(): Flags {
  if (_flags) return _flags;
  const extra: any = Constants.expoConfig?.extra || (Constants as any).manifest?.extra || {};
  _flags = {
    DEBUG_LOGS: toBool(extra.DEBUG_LOGS, true),
    ENABLE_INTROSPECTION: toBool(extra.ENABLE_INTROSPECTION, false),
    ENABLE_PROFILES: toBool(extra.ENABLE_PROFILES, false),
    ENABLE_CONVERSATION_LIST_UX: toBool(extra.ENABLE_CONVERSATION_LIST_UX, false),
    ENABLE_CHAT_UX: toBool(extra.ENABLE_CHAT_UX, false),
    ENABLE_ADD_TO_GROUP: toBool(extra.ENABLE_ADD_TO_GROUP, false),
    ENABLE_UNREAD_BADGE: toBool(extra.ENABLE_UNREAD_BADGE, false),
    ENABLE_AUTH_UX: toBool(extra.ENABLE_AUTH_UX, false),
    ENABLE_NOTIFICATIONS_UX: toBool(extra.ENABLE_NOTIFICATIONS_UX, false),
    ENABLE_THEME: toBool(extra.ENABLE_THEME, false),
    ENABLE_THEME_SKY: toBool(extra.ENABLE_THEME_SKY, true),
    ENABLE_AUTH_GRADIENT_BG: toBool(extra.ENABLE_AUTH_GRADIENT_BG, true),
    ENABLE_AUTH_VERIFICATION_INLINE: toBool(extra.ENABLE_AUTH_VERIFICATION_INLINE, true),
    ENABLE_FORGOT_LINEAR: toBool(extra.ENABLE_FORGOT_LINEAR, true),
    ENABLE_AUTH_ERROR_MAP: toBool(extra.ENABLE_AUTH_ERROR_MAP, true),
    ENABLE_OFFLINE_BANNER: toBool(extra.ENABLE_OFFLINE_BANNER, true),
    ENABLE_ERROR_BOUNDARY_SCREEN: toBool(extra.ENABLE_ERROR_BOUNDARY_SCREEN, true),
    ENABLE_BUTTON_SPINNERS_PRIMARY: toBool(extra.ENABLE_BUTTON_SPINNERS_PRIMARY, true),
    ENABLE_MESSAGE_SKELETONS: toBool(extra.ENABLE_MESSAGE_SKELETONS, true),
    ENABLE_OUTBOX_DRAINER: toBool(extra.ENABLE_OUTBOX_DRAINER, true),
    ENABLE_CONV_INFINITE_SCROLL: toBool(extra.ENABLE_CONV_INFINITE_SCROLL, true),
    ENABLE_MESSAGES_PULL_TO_REFRESH: toBool(extra.ENABLE_MESSAGES_PULL_TO_REFRESH, true),
    PRESENCE_HEARTBEAT_MS: toNum(extra.PRESENCE_HEARTBEAT_MS, 30000),
    NOTIFY_RATE_LIMIT_PER_MINUTE: toNum(extra.NOTIFY_RATE_LIMIT_PER_MINUTE, 10),
    ASSISTANT_ENABLED: toBool(extra.ASSISTANT_ENABLED, false),
    ASSISTANT_CALENDAR_ENABLED: toBool(extra.ASSISTANT_CALENDAR_ENABLED, false),
    ASSISTANT_CALENDAR_READ_ENABLED: toBool(extra.ASSISTANT_CALENDAR_READ_ENABLED, false),
    ASSISTANT_DECISIONS_ENABLED: toBool(extra.ASSISTANT_DECISIONS_ENABLED, false),
    ASSISTANT_PRIORITY_ENABLED: toBool(extra.ASSISTANT_PRIORITY_ENABLED, false),
    ASSISTANT_RSVP_ENABLED: toBool(extra.ASSISTANT_RSVP_ENABLED, false),
    ASSISTANT_DEADLINES_ENABLED: toBool(extra.ASSISTANT_DEADLINES_ENABLED, false),
    ASSISTANT_CONFLICTS_ENABLED: toBool(extra.ASSISTANT_CONFLICTS_ENABLED, false),
    ASSISTANT_GROUP_ENABLED: toBool(extra.ASSISTANT_GROUP_ENABLED, false),
    ENABLE_CONVERSATION_LIST_CACHE: toBool(extra.ENABLE_CONVERSATION_LIST_CACHE, true),
  };
  return _flags;
}

function toBool(v: any, d: boolean): boolean {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return d;
}

function toNum(v: any, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}


