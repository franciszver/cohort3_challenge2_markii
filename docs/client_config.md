### Client configuration for Cognito (email sign-in) and AppSync GraphQL

- Region: us-east-1
- Auth: Cognito User Pool (email sign-in, email verification), Identity Pool (auth-only)
- API: AppSync GraphQL with Cognito User Pools auth
- Token storage: AsyncStorage (default)

#### 1) Install packages (inside your React Native app)
`ash
npm i aws-amplify
`

#### 2) Configure Amplify (use your .env values)
`	ypescript
// app/aws.ts
import { Amplify } from 'aws-amplify';

Amplify.configure({
  Auth: {
    region: process.env.AWS_REGION,
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    userPoolClientId: process.env.COGNITO_CLIENT_ID,
    identityPoolId: process.env.COGNITO_IDENTITY_POOL_ID,
  },
  API: {
    GraphQL: {
      endpoint: process.env.APPSYNC_ENDPOINT,
      defaultAuthMode: 'userPool',
    },
  },
});
`

Note: Inject environment variables using your preferred approach for RN/Expo (e.g., eact-native-dotenv, Expo config, or a custom build-time injector). Keep .env out of version control.

#### 3) Email-based sign up/sign in (custom in-app UI)
`	ypescript
import { signIn, signUp, confirmSignUp } from 'aws-amplify/auth';

export async function registerWithEmail(email: string, password: string) {
  await signUp({ username: email, password, options: { userAttributes: { email } } });
}

export async function confirmEmail(email: string, code: string) {
  await confirmSignUp({ username: email, confirmationCode: code });
}

export async function loginWithEmail(email: string, password: string) {
  await signIn({ username: email, password });
}
`

#### 4) GraphQL client usage (queries/mutations/subscriptions)
`	ypescript
import { generateClient } from 'aws-amplify/api';

const client = generateClient();

// Example: query
export async function runQuery(query: string, variables?: Record<string, any>) {
  return client.graphql({ query, variables, authMode: 'userPool' });
}

// Example: subscription (real-time)
export function subscribe(query: string, variables?: Record<string, any>) {
  return client.graphql({ query, variables, authMode: 'userPool' }).subscribe({
    next: (event) => console.log('event', event),
    error: (err) => console.error(err),
  });
}
`

This setup uses Cognito User Pools for AppSync auth and leverages subscriptions for real-time updates.