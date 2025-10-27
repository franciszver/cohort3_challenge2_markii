# Option 2: AppSync Schema Permissions Fix for Metadata Field

## Context
The mobile app cannot read the `metadata` field on messages sent by `assistant-bot`, even though users are conversation participants and can read the message content.

This is a **field-level authorization** issue in AppSync GraphQL schema.

## Problem
```graphql
# Current behavior:
# User can read Message.content ✅
# User CANNOT read Message.metadata ❌ (null returned)
```

## Solution: Modify AppSync Schema Authorization Rules

### Step 1: Locate the Message Type Definition

Find your `schema.graphql` or `Message` type definition in your AppSync API. It likely looks like:

```graphql
type Message @model @auth(rules: [...]) {
  id: ID!
  conversationId: String! @index(name: "byConversationIdAndCreatedAt", sortKeyFields: ["createdAt"])
  content: String
  attachments: [AWSJSON]
  messageType: MessageType
  senderId: String!
  metadata: AWSJSON  # <-- This field needs permission fix
  editedAt: AWSDateTime
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
}
```

### Step 2: Add Field-Level Authorization for Metadata

**Option A: Make metadata readable by conversation participants**

```graphql
type Message @model @auth(rules: [
  # Existing model-level rules
  { allow: owner, ownerField: "senderId", operations: [create, update, delete] }
  { allow: private, operations: [read] }
]) {
  id: ID!
  conversationId: String! @index(name: "byConversationIdAndCreatedAt", sortKeyFields: ["createdAt"])
  content: String
  attachments: [AWSJSON]
  messageType: MessageType
  senderId: String!
  
  # Add field-level auth to allow conversation participants to read metadata
  metadata: AWSJSON @auth(rules: [
    { allow: owner, ownerField: "senderId", operations: [read, create, update] }
    { allow: private, operations: [read] }  # Allow any authenticated user to read
  ])
  
  editedAt: AWSDateTime
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
}
```

**Option B: Custom resolver to check conversation participation**

If you need stricter control (only conversation participants can read metadata):

1. Create a custom resolver function
2. Check if user is a participant in the conversation
3. Return metadata only if authorized

```javascript
// Lambda resolver for Message.metadata field
export async function resolveMetadata(ctx) {
  const { source, identity } = ctx;
  const userId = identity.sub;
  const conversationId = source.conversationId;
  
  // Check if user is a participant
  const participant = await checkParticipant(conversationId, userId);
  
  if (participant) {
    return source.metadata;
  }
  
  return null; // Not authorized
}
```

### Step 3: Deploy the Schema Changes

```bash
# If using Amplify CLI
amplify push

# If using CDK
cdk deploy

# If using AWS Console
# 1. Go to AppSync Console
# 2. Select your API
# 3. Go to Schema
# 4. Update the Message type
# 5. Save and deploy
```

### Step 4: Test the Fix

After deployment:

1. Clear app cache and reload
2. Send an urgent message: `@Ai URGENT: Test metadata permissions!`
3. Navigate back and reopen the conversation
4. Check logs for: `[debug] Latest assistant message: {"hasMetadata": true, ...}`
5. Verify the red "!" badge appears

## Rollback Plan

If this breaks anything:

```graphql
# Revert to original schema (without field-level @auth on metadata)
type Message @model @auth(rules: [...]) {
  # ... fields ...
  metadata: AWSJSON  # Back to default permissions
  # ... more fields ...
}
```

Then redeploy.

## When to Use This Option

Use Option 2 if:
- Option 1 (subscription) doesn't solve the problem
- Subscriptions have permission issues too
- You need stricter security on metadata field
- You want metadata readable via queries (not just subscriptions)

## Advantages
- ✅ Solves root cause (permissions)
- ✅ Metadata works in queries AND subscriptions
- ✅ No client-side changes needed after initial fix
- ✅ More secure (explicit field-level control)

## Disadvantages
- ❌ Requires backend schema change and deployment
- ❌ Takes longer to implement (~30-60 minutes)
- ❌ Requires AppSync/Amplify expertise
- ❌ Risk of breaking other queries if not careful

## Notes
- The `assistant-bot` user ID must be added as a conversation participant (already implemented)
- Test thoroughly in dev environment first
- Consider making this change in a separate API version if worried about breaking changes

