import 'dotenv/config';
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'NegotiatedAi',
  slug: 'negotiatedai',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    permissions: ['READ_CALENDAR', 'WRITE_CALENDAR'],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  extra: {
    AWS_REGION: process.env.AWS_REGION,
    COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
    COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    COGNITO_IDENTITY_POOL_ID: process.env.COGNITO_IDENTITY_POOL_ID,
    APPSYNC_ENDPOINT: process.env.APPSYNC_ENDPOINT,
    DEBUG_LOGS: process.env.DEBUG_LOGS ?? 'false',
    ENABLE_INTROSPECTION: process.env.ENABLE_INTROSPECTION ?? 'false',
    ENABLE_PROFILES: process.env.ENABLE_PROFILES ?? 'false',
    ENABLE_CONVERSATION_LIST_UX: process.env.ENABLE_CONVERSATION_LIST_UX ?? 'true',
    ENABLE_CHAT_UX: process.env.ENABLE_CHAT_UX ?? 'true',
    ENABLE_UNREAD_BADGE: process.env.ENABLE_UNREAD_BADGE ?? 'true',
    ENABLE_AUTH_UX: process.env.ENABLE_AUTH_UX ?? 'true',
    ENABLE_NOTIFICATIONS_UX: process.env.ENABLE_NOTIFICATIONS_UX ?? 'true',
    ENABLE_THEME: process.env.ENABLE_THEME ?? 'true',
    PRESENCE_HEARTBEAT_MS: process.env.PRESENCE_HEARTBEAT_MS ?? '30000',
    NOTIFY_RATE_LIMIT_PER_MINUTE: process.env.NOTIFY_RATE_LIMIT_PER_MINUTE ?? '10',
    // Assistant MVP flags
    ASSISTANT_ENABLED: process.env.ASSISTANT_ENABLED ?? 'false',
    ASSISTANT_ENDPOINT: process.env.ASSISTANT_ENDPOINT ?? '',
    ASSISTANT_CALENDAR_ENABLED: process.env.ASSISTANT_CALENDAR_ENABLED ?? 'false',
    ASSISTANT_DECISIONS_ENABLED: process.env.ASSISTANT_DECISIONS_ENABLED ?? 'false',
    ASSISTANT_PRIORITY_ENABLED: process.env.ASSISTANT_PRIORITY_ENABLED ?? 'false',
    ASSISTANT_RSVP_ENABLED: process.env.ASSISTANT_RSVP_ENABLED ?? 'false',
    ASSISTANT_DEADLINES_ENABLED: process.env.ASSISTANT_DEADLINES_ENABLED ?? 'false',
    ASSISTANT_CONFLICTS_ENABLED: process.env.ASSISTANT_CONFLICTS_ENABLED ?? 'false',
    ASSISTANT_GROUP_ENABLED: process.env.ASSISTANT_GROUP_ENABLED ?? 'false',
  },
};

export default config;
