import Constants from 'expo-constants';

type Flags = {
  DEBUG_LOGS: boolean;
  ENABLE_INTROSPECTION: boolean;
  ENABLE_PROFILES: boolean;
  ENABLE_CONVERSATION_LIST_UX: boolean;
  ENABLE_CHAT_UX: boolean;
  ENABLE_UNREAD_BADGE: boolean;
  ENABLE_AUTH_UX: boolean;
  ENABLE_NOTIFICATIONS_UX: boolean;
  ENABLE_THEME: boolean;
  PRESENCE_HEARTBEAT_MS: number;
  NOTIFY_RATE_LIMIT_PER_MINUTE: number;
};

let _flags: Flags | null = null;

export function getFlags(): Flags {
  if (_flags) return _flags;
  const extra: any = Constants.expoConfig?.extra || (Constants as any).manifest?.extra || {};
  _flags = {
    DEBUG_LOGS: toBool(extra.DEBUG_LOGS, false),
    ENABLE_INTROSPECTION: toBool(extra.ENABLE_INTROSPECTION, false),
    ENABLE_PROFILES: toBool(extra.ENABLE_PROFILES, false),
    ENABLE_CONVERSATION_LIST_UX: toBool(extra.ENABLE_CONVERSATION_LIST_UX, false),
    ENABLE_CHAT_UX: toBool(extra.ENABLE_CHAT_UX, false),
    ENABLE_UNREAD_BADGE: toBool(extra.ENABLE_UNREAD_BADGE, false),
    ENABLE_AUTH_UX: toBool(extra.ENABLE_AUTH_UX, false),
    ENABLE_NOTIFICATIONS_UX: toBool(extra.ENABLE_NOTIFICATIONS_UX, false),
    ENABLE_THEME: toBool(extra.ENABLE_THEME, false),
    PRESENCE_HEARTBEAT_MS: toNum(extra.PRESENCE_HEARTBEAT_MS, 30000),
    NOTIFY_RATE_LIMIT_PER_MINUTE: toNum(extra.NOTIFY_RATE_LIMIT_PER_MINUTE, 10),
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


