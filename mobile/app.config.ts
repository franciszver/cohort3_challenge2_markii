import 'dotenv/config';
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'cohort3-chat',
  slug: 'cohort3-chat',
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
    PRESENCE_HEARTBEAT_MS: process.env.PRESENCE_HEARTBEAT_MS ?? '30000',
    NOTIFY_RATE_LIMIT_PER_MINUTE: process.env.NOTIFY_RATE_LIMIT_PER_MINUTE ?? '10',
  },
};

export default config;
