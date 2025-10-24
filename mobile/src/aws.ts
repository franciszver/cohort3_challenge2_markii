import { Amplify } from 'aws-amplify';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra || Constants.manifest?.extra || {}) as any;

export function configureAmplify() {
  // debug logs removed
  const config = {
    Auth: {
      Cognito: {
        region: extra.AWS_REGION,
        userPoolId: extra.COGNITO_USER_POOL_ID,
        userPoolClientId: extra.COGNITO_CLIENT_ID,
        identityPoolId: extra.COGNITO_IDENTITY_POOL_ID,
        // loginWith and signUpVerificationMethod are configured in Cognito; not in client
      },
    },
    API: {
      GraphQL: {
        endpoint: extra.APPSYNC_ENDPOINT,
        region: extra.AWS_REGION,
        defaultAuthMode: 'userPool',
      },
    },
  } as const;

  Amplify.configure(config);
}

