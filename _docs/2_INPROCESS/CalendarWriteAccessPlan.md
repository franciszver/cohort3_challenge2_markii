<!-- 716c0291-fbc6-41c0-9c55-4ab1525c4a38 d21f382e-7fac-40e8-a0e7-cc0876dc51fc -->
# Assistant Priority, Deadlines, and RSVP Implementation

## Overview

Implement three new Assistant capabilities in order of complexity, with testing between each:

1. **Priority Highlighting** - Detect and highlight urgent messages
2. **Deadline Extraction** - Find commitments and provide reminders
3. **RSVP Tracking** - Track participant responses to assistant-created events

---

## Phase 1: Priority Highlighting (Simplest)

### Backend: Detection Logic

**File: `scripts/agent/assistant.js`**

Add priority detection function after `extractDecisionsFromRecent`:

```javascript
function detectPriority(text) {
  const urgentKeywords = /\b(urgent|asap|critical|emergency|important|high priority|time sensitive|immediately)\b/i;
  const hasKeyword = urgentKeywords.test(text);
  
  // AI semantic detection would go here when called via OpenAI
  // For now, return keyword-based result
  return hasKeyword ? 'high' : 'normal';
}
```

Integrate into OpenAI system prompt (around line 1265):

```javascript
content: [
  'You are a concise planning assistant...',
  'If the message is urgent, include "priority": "high" in your JSON response.',
].filter(Boolean).join(' ')
```

Update response validation to include priority field in metadata.

### Mobile: UI Badge

**File: `mobile/src/screens/ChatScreen.tsx`**

Add priority badge rendering in message bubble:

- Parse `metadata.priority` from assistant messages
- Show red "!" icon next to urgent messages
- Use existing theme colors for consistency

**File: `mobile/src/utils/flags.ts`**

- Flag `ASSISTANT_PRIORITY_ENABLED` already exists, just needs to be used

### Lambda Deployment

Update environment variable: `ASSISTANT_PRIORITY_ENABLED=true`

### Testing Checkpoint 1

**Prerequisites:**
- Mobile app running with `ASSISTANT_PRIORITY_ENABLED=true` in env
- Lambda deployed with `ASSISTANT_PRIORITY_ENABLED=true`
- Assistant conversation open

**Test Case 1: Urgent keyword detection**
1. Send: "@Ai URGENT: Plan emergency meeting tomorrow 9am"
2. Wait for assistant reply (~5s)
3. **Expected:** Red "!" badge appears next to assistant's message
4. **Verify:** Message metadata contains `priority: "high"`

**Test Case 2: Multiple urgent keywords**
1. Send: "@Ai ASAP need to schedule critical project review"
2. Wait for assistant reply
3. **Expected:** Red "!" badge appears
4. **Verify:** Badge is consistently positioned

**Test Case 3: Normal priority (no keywords)**
1. Send: "@Ai Plan casual coffee Friday"
2. Wait for assistant reply
3. **Expected:** NO priority badge shown
4. **Verify:** Message looks normal, no badge clutter

**Test Case 4: Case insensitivity**
1. Send: "@Ai important: Plan team meeting"
2. **Expected:** Badge appears (lowercase "important" detected)

**Test Case 5: Flag OFF rollback**
1. Set `ASSISTANT_PRIORITY_ENABLED=false` in mobile env
2. Rebuild app
3. Send urgent message
4. **Expected:** No badge shown, feature completely hidden

**Debug checks:**
- Check Lambda logs for `[priority]` entries
- Check mobile console for `metadata.priority` parsing
- Verify badge color matches theme danger color

---

## Phase 2: Deadline Extraction (Medium)

### Backend: Extraction Logic

**File: `scripts/agent/assistant.js`**

Add deadline extraction function:

```javascript
function extractDeadlines(text, createdAt) {
  const patterns = [
    /\b(?:due|deadline|submit|complete|finish|needs to be done)\s+(?:by\s+)?([a-zA-Z]+\s+\d{1,2}|\d{1,2}\/\d{1,2}|tomorrow|next\s+\w+)/i,
    /\bby\s+([a-zA-Z]+\s+\d{1,2}|tomorrow)/i
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const dateStr = match[1];
      const deadline = parseDeadlineDate(dateStr, createdAt);
      if (deadline) {
        return {
          title: text.slice(0, 100),
          dueISO: deadline.toISOString(),
          createdAtISO: createdAt
        };
      }
    }
  }
  return null;
}
```

Store deadlines in `metadata.deadlines` array, similar to decisions.

### Mobile: Deadlines List View

**File: `mobile/src/screens/DeadlinesScreen.tsx` (NEW)**

Create new screen accessible from ConversationListScreen:

- Query messages with `metadata.deadlines`
- Display sorted by due date
- Show status: upcoming, today, overdue
- Badge with count of active deadlines

**File: `mobile/src/screens/ChatScreen.tsx`**

- Add deadline badge icon (📌) on messages with deadlines
- Tap to expand deadline details

### Notifications

**File: `mobile/src/utils/notifications.ts` (NEW or existing)**

- Schedule local notification 24 hours before deadline
- Use expo-notifications
- Cancel notification if deadline is marked complete

### Lambda Deployment

Update environment variable: `ASSISTANT_DEADLINES_ENABLED=true`

### Testing Checkpoint 2

**Prerequisites:**
- Mobile app running with `ASSISTANT_DEADLINES_ENABLED=true`
- Lambda deployed with `ASSISTANT_DEADLINES_ENABLED=true`
- Notification permissions granted on device
- DeadlinesScreen accessible from ConversationListScreen

**Test Case 1: Basic deadline extraction**
1. Send: "@Ai Reminder: Submit report by Friday"
2. Wait for assistant reply
3. **Expected:** 📌 badge appears next to message
4. Tap the 📌 badge
5. **Expected:** Deadline details expand showing "Due: Friday [date]"

**Test Case 2: Deadlines list view**
1. Navigate to ConversationListScreen
2. Tap "Deadlines" button/icon (should show count badge if deadlines exist)
3. **Expected:** DeadlinesScreen opens
4. **Verify:** "Submit report" deadline listed
5. **Verify:** Sorted by due date (soonest first)
6. **Verify:** Shows status (upcoming / today / overdue)

**Test Case 3: Multiple deadline formats**
1. Send: "@Ai deadline tomorrow: finish presentation"
2. Send: "@Ai complete project by Monday"
3. Send: "@Ai needs to be done 11/15"
4. Navigate to Deadlines screen
5. **Expected:** All three deadlines listed with correct dates

**Test Case 4: 24-hour notification**
1. Send: "@Ai due tomorrow 3pm: call client"
2. Wait 24 hours (or use device time travel to 23 hours from now)
3. **Expected:** Local notification appears: "Deadline reminder: call client due in 1 hour"
4. Tap notification
5. **Expected:** App opens to deadline details or chat

**Test Case 5: Overdue status**
1. Set device date to 2 days after Friday
2. Open Deadlines screen
3. **Expected:** "Submit report" shows as OVERDUE in red
4. **Verify:** Still listed (not auto-deleted)

**Test Case 6: No deadline in normal message**
1. Send: "@Ai Plan casual dinner Friday"
2. **Expected:** NO 📌 badge (it's an event, not a deadline)

**Test Case 7: Flag OFF rollback**
1. Set `ASSISTANT_DEADLINES_ENABLED=false` in mobile env
2. Rebuild app
3. **Expected:** Deadlines screen hidden from navigation
4. **Expected:** 📌 badges don't appear on new messages
5. **Expected:** Existing notifications cancelled

**Debug checks:**
- Lambda logs show `[deadline]` extraction entries
- Mobile logs show notification scheduling: `[notification] scheduled for [timestamp]`
- Verify notification permissions granted: Check device Settings → App → Notifications

---

## Phase 3: RSVP Tracking (Most Complex)

### Backend: RSVP State Management

**File: `scripts/agent/assistant.js`**

Add RSVP tracking structure:

```javascript
// In metadata.events, add rsvpEnabled: true
{
  title: "Tennis",
  startISO: "...",
  endISO: "...",
  rsvpEnabled: true,
  rsvpResponses: {
    "user-id-1": { status: "yes", respondedAt: "..." },
    "user-id-2": { status: "maybe", respondedAt: "..." }
  }
}
```

Add RSVP detection function:

```javascript
function detectRSVP(text) {
  const yesPatterns = /\b(i'm in|count me in|yes|i'll be there|i can make it|sounds good)\b/i;
  const noPatterns = /\b(i'm out|count me out|no|can't make it|won't be there|can't attend)\b/i;
  const maybePatterns = /\b(maybe|not sure|might|possibly|tentative)\b/i;
  
  if (yesPatterns.test(text)) return 'yes';
  if (noPatterns.test(text)) return 'no';
  if (maybePatterns.test(text)) return 'maybe';
  return null;
}
```

Add new endpoint or extend existing to handle RSVP updates:

- POST /agent/rsvp
- Update message metadata.events[].rsvpResponses
- Broadcast update via AppSync mutation

### Mobile: RSVP UI

**File: `mobile/src/screens/ChatScreen.tsx`**

Enhance event CTA section:

- Show RSVP buttons (✓ Yes | ? Maybe | ✗ No) below "Add to Calendar"
- Display RSVP summary: "3 yes, 1 maybe, 2 no reply"
- Tap summary to see participant details modal
- Natural language detection: auto-submit RSVP when user says "I'm in"

**File: `mobile/src/components/RSVPStatusModal.tsx` (NEW)**

- Modal showing participant names + status
- Uses conversation participants list
- Shows timestamps for responses

### Natural Language Auto-RSVP

**File: `mobile/src/screens/ChatScreen.tsx`**

After sending message:

- Check if conversation has recent assistant events with rsvpEnabled
- Run detectRSVP on user's message
- If match, auto-submit RSVP and show toast: "RSVP recorded: Yes"

### Lambda Deployment

Update environment variable: `ASSISTANT_RSVP_ENABLED=true`

### Testing Checkpoint 3

**Prerequisites:**
- Mobile app running with `ASSISTANT_RSVP_ENABLED=true`
- Lambda deployed with `ASSISTANT_RSVP_ENABLED=true`
- Group conversation with 2+ participants (or use two test accounts)
- Assistant has created an event with `rsvpEnabled: true`

**Test Case 1: RSVP buttons appear**
1. Send: "@Ai Plan tennis Friday 9am with the group"
2. Wait for assistant reply with event
3. **Expected:** Event card shows "Add to Calendar" CTA
4. **Expected:** Below CTA, RSVP buttons appear: ✓ Yes | ? Maybe | ✗ No
5. **Expected:** Default status shows "0 yes, 0 maybe, 0 no"

**Test Case 2: Manual RSVP via button**
1. Tap "✓ Yes" button
2. **Expected:** Button becomes highlighted/selected
3. **Expected:** Status updates to "1 yes, 0 maybe, 0 no"
4. **Expected:** Small confirmation toast: "RSVP: Yes"
5. Tap "? Maybe" button (change mind)
6. **Expected:** Status updates to "0 yes, 1 maybe, 0 no"
7. **Expected:** Previous "Yes" button no longer highlighted

**Test Case 3: Natural language RSVP auto-detection**
1. In the same conversation, send: "I'm in for tennis!"
2. **Expected:** Toast appears: "RSVP recorded: Yes"
3. **Expected:** Event status updates to "1 yes, 1 maybe, 0 no" (if 2 users)
4. Send: "Actually, can't make it"
5. **Expected:** RSVP updates to "No", status reflects change

**Test Case 4: Multiple participants**
1. From User A account: Tap "✓ Yes"
2. From User B account (different device/browser): Send "count me in"
3. **Expected:** Both devices show "2 yes"
4. From User C account: Tap "✗ No"
5. **Expected:** All devices show "2 yes, 0 maybe, 1 no"

**Test Case 5: RSVP details modal**
1. Tap the status summary text ("2 yes, 0 maybe, 1 no")
2. **Expected:** RSVPStatusModal opens
3. **Expected:** Shows list:
   - Alice ✓ (responded 2 min ago)
   - Bob ✓ (responded 1 min ago)
   - Charlie ✗ (responded just now)
   - Dave (no response yet)
4. **Verify:** Timestamps are human-readable ("2 min ago")
5. Tap outside modal to close

**Test Case 6: Real-time updates via subscription**
1. Keep User A's app open on event screen
2. From User B device: Change RSVP from Yes to Maybe
3. **Expected:** User A sees count update WITHOUT refresh
4. **Verify:** Update happens within 1-2 seconds (AppSync subscription)

**Test Case 7: RSVP on old events**
1. Scroll to event from yesterday
2. **Expected:** RSVP buttons still appear and functional
3. Tap Yes
4. **Expected:** Works normally (no time limit on RSVPs)

**Test Case 8: No RSVP on non-event messages**
1. Assistant sends regular text reply (no event metadata)
2. **Expected:** NO RSVP buttons shown
3. Assistant sends event but `rsvpEnabled: false`
4. **Expected:** "Add to Calendar" shows, but NO RSVP buttons

**Test Case 9: Natural language false positives**
1. Send: "No thanks, I don't need calendar access" (should NOT be RSVP)
2. **Expected:** NO RSVP toast, status unchanged
3. Send: "Yes, I agree with the time" (context: event exists)
4. **Expected:** RSVP detected as "Yes"

**Test Case 10: Race condition handling**
1. From 2 devices simultaneously: Both tap "Yes" at exact same time
2. **Expected:** Both RSVPs recorded (no data loss)
3. **Acceptable:** Last write wins, but count is correct
4. **Verify:** Check Lambda/AppSync logs for concurrency handling

**Test Case 11: Flag OFF rollback**
1. Set `ASSISTANT_RSVP_ENABLED=false` in mobile env
2. Rebuild app
3. **Expected:** RSVP buttons completely hidden
4. **Expected:** Existing RSVP data preserved (not deleted)
5. **Verify:** "Add to Calendar" still works normally

**Debug checks:**
- Lambda logs show `[rsvp]` entries when storing responses
- Mobile logs show `[rsvp:update]` when calling updateMessage mutation
- Check AppSync mutation logs for `updateMessage` with metadata changes
- Verify subscription fires: `[sub] evt` with updated metadata
- Network tab shows GraphQL mutation payload includes rsvpResponses

---

## Implementation Order Summary

1. **Priority** → Test → Confirm working
2. **Deadlines** → Test → Confirm working  
3. **RSVP** → Test → Confirm working

Each feature is independently flag-gated for safe rollback.

## Key Files Modified

**Backend:**

- `scripts/agent/assistant.js` - Add detection functions and metadata handling
- `scripts/agent/deploy.ps1` - Add new environment variables

**Mobile:**

- `mobile/src/screens/ChatScreen.tsx` - UI for all three features
- `mobile/src/screens/DeadlinesScreen.tsx` - NEW deadline list view
- `mobile/src/components/RSVPStatusModal.tsx` - NEW RSVP details modal
- `mobile/src/utils/flags.ts` - Already has flags defined
- `mobile/src/utils/notifications.ts` - Deadline reminders
- `mobile/app.config.ts` - Add notification permissions if needed

**Total estimated implementation time:** 6-8 hours across all three features

### To-dos

- [ ] Implement priority detection function in Lambda and integrate with OpenAI prompt
- [ ] Add priority badge UI to ChatScreen messages
- [ ] Deploy Lambda with ASSISTANT_PRIORITY_ENABLED=true
- [ ] Test priority highlighting with urgent and normal messages
- [ ] Implement deadline extraction function and metadata storage in Lambda
- [ ] Create DeadlinesScreen component with sorted deadline list
- [ ] Add deadline badge to ChatScreen messages
- [ ] Implement 24-hour reminder notifications using expo-notifications
- [ ] Deploy Lambda with ASSISTANT_DEADLINES_ENABLED=true
- [ ] Test deadline extraction, list view, and notification scheduling
- [ ] Add RSVP state structure to events metadata and detection function
- [ ] Create or extend Lambda endpoint to handle RSVP updates
- [ ] Add RSVP buttons (Yes/Maybe/No) to event CTAs in ChatScreen
- [ ] Display RSVP summary count below events
- [ ] Create RSVPStatusModal component showing participant details
- [ ] Implement auto-RSVP detection from natural language responses
- [ ] Deploy Lambda with ASSISTANT_RSVP_ENABLED=true
- [ ] Test RSVP buttons, natural language detection, and participant tracking