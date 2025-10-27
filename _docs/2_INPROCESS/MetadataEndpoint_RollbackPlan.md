# Metadata Endpoint Rollback Plan

## What We're Changing

### Lambda (`scripts/agent/assistant.js`)
- **Adding:** New route handler for `GET /metadata/:messageId`
- **Location:** Near line ~50-60 (after existing route handlers)
- **Lines affected:** ~30 new lines

### Mobile (`mobile/src/screens/ChatScreen.tsx`)
- **Adding:** Metadata fetch call in subscription handler
- **Location:** In the `onMessageInConversation` subscription handler (~line 410-430)
- **Lines affected:** ~15 new lines

## Rollback Instructions

### If Priority Badge Works:
1. Keep both changes
2. Mark `priority-test` as completed
3. Move on to Deadlines feature

### If It Doesn't Work OR Causes Issues:

#### Step 1: Revert Mobile Changes
```typescript
// In ChatScreen.tsx, around line 410-430
// REMOVE this block:
if (m?.senderId === 'assistant-bot') {
    setTimeout(async () => {
        try {
            const metadataRes = await fetch(`${ASSISTANT_ENDPOINT}/metadata/${m.id}`, {
                headers: { Authorization: `Bearer ${jwt}` }
            });
            const data = await metadataRes.json();
            if (data?.metadata) {
                setMessages(prev => mergeDedupSort(prev, [{ ...m, metadata: data.metadata }]));
            }
        } catch (e) {
            console.warn('[metadata] Failed to fetch:', e);
        }
    }, 500);
}

// KEEP only this:
if (m?.senderId === 'assistant-bot') {
    if (m.metadata && m.metadata !== 'null') {
        console.log('[metadata] ✅ Received metadata via subscription for', m.id.slice(0, 8));
    } else {
        console.log('[metadata] ⏳ Waiting for metadata update via subscription for', m.id.slice(0, 8));
    }
}
```

#### Step 2: Revert Lambda Changes
```javascript
// In scripts/agent/assistant.js
// REMOVE the entire metadata endpoint block (search for "GET /metadata")
// Should be around line 50-90
```

#### Step 3: Redeploy Lambda
```powershell
cd scripts/agent
node ../../scripts/push-schema.js  # If schema was touched
$env:AWS_PROFILE='ciscodg@gmail'
.\deploy.ps1 -Profile 'ciscodg@gmail' -Region us-east-1 `
    -AppSyncApiId ke2mzdeb7bgolo7gf7bjyfxa5i `
    -AppSyncEndpoint "https://ke2mzdeb7bgolo7gf7bjyfxa5i.appsync-api.us-east-1.amazonaws.com/graphql" `
    -EnableOpenAI -EnableDecisions -EnableConflicts -EnablePriority `
    -OpenAISecretArn 'arn:aws:secretsmanager:us-east-1:971422717446:secret:openai/assistant-UCI9C9' `
    -ApiId vp6vbtipoi
```

#### Step 4: Rebuild Mobile
```bash
cd mobile
npx expo start --clear
```

#### Step 5: Test Clean State
- Send a normal message
- Verify no errors in logs
- Verify existing functionality works

## Alternative: Just Disable, Don't Remove

If you want to keep the code but disable it:

### Mobile:
```typescript
const USE_METADATA_ENDPOINT = false; // Set to false to disable

if (USE_METADATA_ENDPOINT && m?.senderId === 'assistant-bot') {
    // ... metadata fetch code ...
}
```

### Lambda:
```javascript
const METADATA_ENDPOINT_ENABLED = false; // Set to false to disable

if (METADATA_ENDPOINT_ENABLED && event.path === '/metadata') {
    // ... endpoint code ...
}
```

Then just toggle these flags to enable/disable without code changes.

## Files to Backup Before Starting

```bash
# Create backups
cp scripts/agent/assistant.js scripts/agent/assistant.js.backup
cp mobile/src/screens/ChatScreen.tsx mobile/src/screens/ChatScreen.tsx.backup
```

## If Everything Breaks

### Emergency Full Rollback:
```bash
# Restore backups
cp scripts/agent/assistant.js.backup scripts/agent/assistant.js
cp mobile/src/screens/ChatScreen.tsx.backup mobile/src/screens/ChatScreen.tsx

# Redeploy everything
cd scripts/agent && ./deploy.ps1 [params...]
cd ../../mobile && npx expo start --clear
```

## Success Criteria

**Test passes if:**
- ✅ Send `@Ai URGENT: Test!`
- ✅ See: `[metadata] Fetching from endpoint for [id]`
- ✅ See: `[metadata] ✅ Fetched successfully`
- ✅ Red "!" badge appears within 1 second
- ✅ No errors in mobile or Lambda logs

**Rollback if:**
- ❌ Metadata fetch returns 403/500
- ❌ Mobile app crashes
- ❌ Existing messages stop loading
- ❌ Lambda errors increase
- ❌ Badge still doesn't appear after 5 seconds

## Notes
- Keep Lambda logs open during testing
- Watch mobile logs for fetch errors
- Test with both urgent and normal messages
- Verify existing event scheduling still works

