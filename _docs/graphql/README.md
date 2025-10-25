### AppSync GraphQL schema and usage

- Region: `us-east-1`
- Auth mode: Cognito User Pools (User Pool ID from .env)

Before AWS actions in PowerShell:

```powershell
$env:AWS_PROFILE='my-aws-profile'
```

#### Register schema
- In the AppSync console, create or select your API and paste the canonical root schema from `schema.graphql` (repo root) into the Schema editor.
- Set default authorization to Cognito User Pools and select your User Pool.
- Create resolvers for:
  - `Query.getUserProfile`
  - `Query.listMessages`
  - `Mutation.updateUserProfile`
  - `Mutation.sendMessage`
  - `Subscription.onMessageToUser` (filter by `receiverId`)

#### Example GraphQL documents

```graphql
mutation UpdateUserProfile($input: UpdateUserProfileInput!) {
  updateUserProfile(input: $input) {
    userId
    username
    avatar
    status
    updatedAt
  }
}
```

```graphql
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
```

```graphql
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
```
