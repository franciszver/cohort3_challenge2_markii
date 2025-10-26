<!-- a84c2fd2-172b-45dc-8473-0fd4dd4e7af7 c17a990b-0286-408b-97a4-a3b0d76bd05b -->
# Nickname Feature Implementation Analysis

## Current Architecture Summary

The app currently displays user identities in multiple places:

**ChatScreen.tsx:**

- Message bubbles show `userIdToEmail[senderId]` (line 1008)
- Participants modal shows email addresses (line 1261-1269)
- Header shows conversation name or participant names

**ConversationListScreen.tsx:**

- Conversation list items show email addresses or profile names (firstName + lastName)
- Uses `batchGetUsersCached()` and `batchGetProfilesCached()` for efficient loading

**Storage & Caching:**

- AsyncStorage extensively used for local caching (messages, drafts, profiles)
- In-memory TTL caches for users and profiles (5-minute TTL)
- Backend: AppSync/GraphQL with DynamoDB tables (Users, UserProfile, Messages, Conversations)

## Implementation Complexity Assessment

### Frontend-Only Implementation: **LOW COMPLEXITY** ⭐

**Storage Approach:**

```typescript
// AsyncStorage structure:
// Key: 'nicknames'
// Value: { [userId: string]: string }
// Example: { "user-123": "Bob", "user-456": "Alice" }
```

**Files to Modify:**

1. Create `mobile/src/utils/nicknames.ts` - nickname management utility
2. Modify `mobile/src/screens/ChatScreen.tsx` - display nicknames in messages
3. Modify `mobile/src/screens/ConversationListScreen.tsx` - display nicknames in list
4. Add nickname editor modal in ChatScreen (long-press user ID → edit nickname)

**Implementation Steps:**

1. Create nickname storage utility with AsyncStorage
2. Add display layer that checks nicknames before showing userID/email
3. Add UI to set/edit nicknames (modal with text input)
4. Handle nickname display priority: nickname → firstName/lastName → email → userId

**Estimated Effort:** 2-4 hours

**Pros:**

- No backend changes
- Works immediately
- Works offline
- User has full control
- Simple to implement and test
- Can set nicknames for ANY user ID

**Cons:**

- Lost if app data cleared (can mitigate with cloud backup)
- Not synced across user's devices
- Only visible to the user who set them

### Backend Implementation: **MEDIUM-HIGH COMPLEXITY** ⭐⭐⭐

**Architecture Decision Required:**

Choose between:

1. **Personal Nicknames** (private to each user) - more complex but private
2. **Shared Nicknames** (set by user, visible to others) - simpler but less private

**Option 1: Personal Nicknames (Recommended)**

**New DynamoDB Table Required:**

```
UserNicknames
  PK: userId (the user who SET the nickname)
  SK: targetUserId (the user being nicknamed)
  nickname: string
  createdAt: timestamp
  updatedAt: timestamp
```

**GraphQL Schema Changes:**

```graphql
type UserNickname {
  userId: ID!
  targetUserId: ID!
  nickname: String!
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
}

input SetNicknameInput {
  targetUserId: ID!
  nickname: String!
}

type Mutation {
  setNickname(input: SetNicknameInput!): UserNickname
  deleteNickname(targetUserId: ID!): Boolean
}

type Query {
  listMyNicknames(limit: Int, nextToken: String): ModelUserNicknameConnection
  getNickname(targetUserId: ID!): UserNickname
}
```

**Files to Create/Modify:**

1. Update `schema.graphql`
2. Create AppSync resolvers (VTL or Lambda):

   - `Mutation.setNickname.request/response.vtl`
   - `Mutation.deleteNickname.request/response.vtl`
   - `Query.listMyNicknames.request/response.vtl`

3. Create `mobile/src/graphql/nicknames.ts`
4. Modify ChatScreen and ConversationListScreen
5. Add sync logic to fetch nicknames on app launch
6. Handle offline mutations (optimistic updates)

**Infrastructure Changes:**

- Create DynamoDB table via AWS CLI or CloudFormation
- Add IAM policies for table access
- Update AppSync data sources
- Deploy resolvers

**Estimated Effort:** 8-16 hours (including testing and deployment)

**Pros:**

- Synced across all user's devices
- Persistent and durable
- Professional solution
- Can add features like nickname history, import/export

**Cons:**

- Requires backend deployment
- More complex testing required
- Need to handle sync conflicts
- Additional infrastructure costs (minimal)
- Offline support requires queue/sync logic

**Option 2: Shared Nicknames (Simpler Backend)**

Add `nickname` field to existing `UserProfile` table - user sets their own nickname that others see.

**Schema Change:**

```graphql
type UserProfile {
  # ... existing fields
  nickname: String  # Self-set nickname
}
```

This is simpler but changes the feature:

- Users set nicknames FOR THEMSELVES, not for others
- Everyone sees the same nickname
- Less flexible than personal nicknames

**Estimated Effort:** 4-6 hours

## Recommended Approach

### For MVP/Quick Implementation: **Frontend-Only** ✅

Start with frontend-only implementation because:

1. Can be done in a few hours
2. No backend coordination needed
3. Delivers immediate value
4. Can migrate to backend later if needed
5. Perfect for personal use case you described

### Migration Path (if needed later):

1. Keep frontend nickname utility
2. Add backend sync as enhancement
3. Merge local + server nicknames (local takes precedence for conflicts)
4. Gradual rollout to users

## Display Priority Logic

Regardless of approach, implement this display hierarchy:

```typescript
function getDisplayName(userId: string): string {
  // 1. Check for user-set nickname (highest priority)
  const nickname = getNickname(userId);
  if (nickname) return nickname;
  
  // 2. Check for user profile (firstName + lastName)
  const profile = getProfile(userId);
  if (profile?.firstName || profile?.lastName) {
    return `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  }
  
  // 3. Check for email
  const user = getUser(userId);
  if (user?.email) return user.email;
  
  // 4. Fallback to userId
  return userId;
}
```

## Implementation Challenges by Approach

### Frontend-Only Challenges: ⚠️ LOW

1. **UI/UX Design** - where to put "set nickname" button (modal trigger)
2. **AsyncStorage management** - simple key-value store
3. **Display layer integration** - 3-4 files to modify
4. **Testing** - straightforward unit tests

### Backend Challenges: ⚠️ MEDIUM

1. **Schema design** - personal vs shared nicknames decision
2. **Auth/permissions** - ensuring users can only set their own nicknames
3. **Resolver logic** - VTL templates or Lambda functions
4. **Sync conflicts** - handling offline edits
5. **Migration** - adding table without breaking existing data
6. **Performance** - need to batch-fetch nicknames efficiently
7. **Testing** - unit tests + integration tests + backend deployment testing

## Key Files Reference

**User Display Locations:**

- `mobile/src/screens/ChatScreen.tsx:1008` - message sender labels
- `mobile/src/screens/ConversationListScreen.tsx:573-594` - conversation titles
- `mobile/src/screens/ChatScreen.tsx:1258-1276` - participants modal

**Storage Utilities:**

- `mobile/src/graphql/users.ts` - user fetching with cache
- `mobile/src/graphql/profile.ts` - profile fetching with cache
- AsyncStorage used throughout for local persistence

**Backend Schema:**

- `schema.graphql` - GraphQL type definitions
- `_docs/appsync/resolvers/` - VTL resolver templates

## Recommendation

✅ **Start with Frontend-Only implementation** for your use case:

- Matches your scenario perfectly (personal nicknames for your own contacts)
- Quick to implement and test
- No backend coordination delays
- Can always upgrade to backend sync later if multi-device sync is needed

The frontend-only approach will take approximately **2-4 hours** to implement fully, while the backend approach would take **8-16 hours** plus deployment time.