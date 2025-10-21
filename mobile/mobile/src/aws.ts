import { Amplify } from 'aws-amplify';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || Constants.manifest?.extra || {}) as any;

export function configureAmplify() {
  Amplify.configure({
    Auth: {
      region: extra.AWS_REGION,
      userPoolId: extra.COGNITO_USER_POOL_ID,
      userPoolClientId: extra.COGNITO_CLIENT_ID,
      identityPoolId: extra.COGNITO_IDENTITY_POOL_ID,
    },
    API: {
      GraphQL: {
        endpoint: extra.APPSYNC_ENDPOINT,
        defaultAuthMode: 'userPool',
      },
    },
  });
}
