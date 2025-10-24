<!-- 0a07f87b-37a4-4f04-af8a-de555c48c1d8 1561b2b0-b9fd-4715-8feb-f00d2f150049 -->
# User Profiles with Initials Avatars

## Best practice choice

- Use a dedicated `UserProfile` model (AppSync+DynamoDB) keyed by `userId` (Cognito `sub`). Enforce `userId` from `identity.sub` in the update resolver to prevent spoofing. Create/ensure profile on first successful sign-in (after email verification), not during `signUp`.

## Data model and API (AppSync)

- Extend schema (server) with:
```graphql
# schema.graphql additions

type UserProfile @aws_cognito_user_pools {
  userId: ID!
  firstName: String!
  lastName: String!
  email: String!
  avatarColor: String
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
}

extend type Query @aws_cognito_user_pools {
  getUserProfile(userId: ID!): UserProfile
}

input UpdateUserProfileInput {
  firstName: String
  lastName: String
  avatarColor: String
}

extend type Mutation @aws_cognito_user_pools {
  updateUserProfile(input: UpdateUserProfileInput!): UserProfile
}
```

- Resolvers (VTL) [use existing scaffolding in `_docs/appsync/resolvers/*UserProfile*`]:
  - `Query.getUserProfile`: GetItem by `userId`.
  - `Mutation.updateUserProfile`: UpdateItem with `userId = $context.identity.sub`, set `email` from identity claims, set `createdAt` if missing; always set `updatedAt`.

## Mobile GraphQL client

- Replace `mobile/src/graphql/profile.ts` with fields matching above schema and add cached batch getter:
  - `getUserProfile(userId)` returns `{ userId, firstName, lastName, email, avatarColor }`.
  - `updateUserProfile({ firstName, lastName, avatarColor })` (server derives `userId`).
  - `batchGetProfilesCached(userIds: string[])` with in-memory TTL cache (similar to `batchGetUsersCached`).

## UI components

- New `mobile/src/components/Avatar.tsx`:
  - Props: `{ userId?: string; firstName?: string; lastName?: string; email?: string; color?: string; size?: number; onPress?: () => void }`.
  - Renders a circle with background `color` or `colorForId(userId||email)` and initials from `firstName/lastName` (fallback to email/username).
  - Export `colorForId(id: string)` using a small hash → palette index (stable “random”).
- New `mobile/src/components/ProfileModal.tsx`:
  - Props: `{ visible, onClose, user: { userId, firstName, lastName, email, color? } }`.
  - Shows large `Avatar` on top, then the email text, and a Close button.

## Auth flow changes

- `mobile/src/screens/AuthScreen.tsx`:
  - Add two required inputs on Sign Up: First Name, Last Name.
  - After successful `signIn`, call `ensureProfile({ firstName, lastName })`:
    - Fetch `getUserProfile(me.userId)`; if missing or missing names, call `updateUserProfile({ firstName, lastName, avatarColor: colorForId(me.userId) })`.
  - For existing users (no cached names), if profile missing, prompt a minimal modal to collect names before continuing.

## Chat UI updates

- `mobile/src/components/ChatHeader.tsx`:
  - Accept `profile?: { firstName, lastName, email, avatarColor }` and render `Avatar` instead of gray placeholder; wrap avatar in a `TouchableOpacity` to open `ProfileModal`.
- `mobile/src/screens/ConversationListScreen.tsx`:
  - For each conversation, fetch `batchGetProfilesCached` for first 2 participants to render composite initials avatars.
  - Tapping the avatar area opens `ProfileModal` for the first non-self participant.
  - Title prefers `firstName lastName` of the non-self participant (1:1) or conversation name.
- `mobile/src/screens/ChatScreen.tsx`:
  - On mount, resolve the “other” participant’s profile and pass to `ChatHeader`.
  - In the message list, remove `senderId:` text. For messages not from me, show a small `Avatar` to the left; tap opens `ProfileModal` for that sender.

## Utilities and fallbacks

- `Avatar` initials fallback order: `(firstName, lastName)` → `email local-part` → `username` → `??`.
- Color palette: 12–16 accessible colors; `colorForId` picks a stable one from `userId` hash.
- Keep existing `User` queries for presence; profiles are used only for display/name/icon.

## Out of scope (later)

- Editing profile fields, uploading custom avatars, group member list popups, profile privacy controls.

### To-dos

- [ ] Add UserProfile type and update/get mutations in schema and resolvers
- [ ] Update mobile/src/graphql/profile.ts to new fields and add batch cache
- [ ] Create Avatar component with initials and stable color
- [ ] Create ProfileModal with large avatar and email
- [ ] Add first/last name to signup and ensure profile after sign-in
- [ ] Update ChatHeader to use Avatar and open ProfileModal
- [ ] Show avatars in ChatScreen messages and remove senderId text
- [ ] Use profiles in ConversationList for avatars and names