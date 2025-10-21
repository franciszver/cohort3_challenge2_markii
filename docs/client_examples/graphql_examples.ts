### Client GraphQL examples (Amplify API)

```typescript
import { generateClient } from 'aws-amplify/api';

const client = generateClient();

export async function updateProfile(input: { username?: string; avatar?: string; status?: string }) {
  const mutation = /* GraphQL */ `
    mutation UpdateUserProfile($input: UpdateUserProfileInput!) {
      updateUserProfile(input: $input) {
        userId
        username
        avatar
        status
        updatedAt
      }
    }
  `;
  return client.graphql({ query: mutation, variables: { input }, authMode: 'userPool' });
}

export async function sendMessage(receiverId: string, content: string) {
  const mutation = /* GraphQL */ `
    mutation SendMessage($input: SendMessageInput!) {
      sendMessage(input: $input) {
        messageId
        senderId
        receiverId
        content
        timestamp
        status
      }
    }
  `;
  return client.graphql({ query: mutation, variables: { input: { receiverId, content } }, authMode: 'userPool' });
}

export function subscribeToIncomingMessages(userId: string) {
  const subscription = /* GraphQL */ `
    subscription OnMessageToUser($receiverId: ID!) {
      onMessageToUser(receiverId: $receiverId) {
        messageId
        senderId
        receiverId
        content
        timestamp
        status
      }
    }
  `;
  return client.graphql({ query: subscription, variables: { receiverId: userId }, authMode: 'userPool' }).subscribe({
    next: (event) => console.log('incoming message', event.data?.onMessageToUser),
    error: (err) => console.error(err),
  });
}
```
