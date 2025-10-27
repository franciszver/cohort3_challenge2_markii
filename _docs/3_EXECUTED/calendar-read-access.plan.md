<!-- 716c0291-fbc6-41c0-9c55-4ab1525c4a38 a06c44ff-2e4d-4e0d-8cfd-717f7ea0508b -->
# Calendar Read Access for Assistant

## Overview

Enable the Assistant to read device calendar events (next 14 days), detect conflicts proactively, and give users control over whether calendar data is sent to the Lambda/OpenAI backend or kept local-only.

## Key User Flow

1. User opens assistant chat, consent modal appears (first time only)
2. User chooses: "Yes, use my calendar" (sends to backend) OR "Local conflicts only" (privacy mode) OR "No thanks"
3. If yes/local → request calendar permissions
4. On every assistant message, read next 14 days of events from ALL device calendars
5. Send to Lambda (if user consented) OR detect conflicts locally (privacy mode)
6. Assistant proactively warns: "Friday: 9am conflict with existing event" (generic, no title)
7. User can change calendar settings anytime via chat menu or profile screen

## Implementation Steps

### 1. Mobile: iOS Permission Configuration

**File**: `mobile/app.config.ts`

- Add `ios.infoPlist.NSCalendarsUsageDescription` and `NSCalendarsFullAccessUsageDescription`
- Text: "The Assistant can check your calendar for conflicts when planning events. You control whether this data is shared."

### 2. Mobile: Consent Modal Component

**File**: `mobile/src/components/CalendarConsentModal.tsx` (new)

- Modal with three options:
- "Yes, use my calendar for smart planning" (stores `calendarConsent=full`)
- "Local conflicts only (more private)" (stores `calendarConsent=local`)
- "No thanks" (stores `calendarConsent=none`)
- Store choice in AsyncStorage `calendar:consent`
- Show only once per install (or when re-enabled after denial)
- Clear explanation: "Full mode shares event times (not titles) with our AI for better planning. Local mode keeps all data on your device."

### 3. Mobile: Calendar Reading Utility

**File**: `mobile/src/utils/calendar.ts` (new)

- `async function requestCalendarPermissions()` → requests READ_CALENDAR
- `async function getAllCalendarEvents(daysAhead = 14)` → uses `Calendar.getCalendarsAsync()` + `Calendar.getEventsAsync()`
- Fetches from ALL calendars (per user choice 1a)
- Returns serialized events: `{ startISO, endISO }` (no titles, per privacy choice 5b)
- Error handling for permission denial

### 4. Mobile: Update Assistant Request Flow

**File**: `mobile/src/screens/ChatScreen.tsx`

- In `onSend()` where assistant is triggered (lines 750-787):
- Check `calendar:consent` from AsyncStorage
- If `none` → skip calendar read
- If `local` or `full` → call `getAllCalendarEvents(14)`
- If `full` → include in request body: `calendarEvents: [{ startISO, endISO }, ...]`
- If `local` → run local conflict detection (see step 5)
- Handle permission errors → show banner with "tap to enable"

### 5. Mobile: Local Conflict Detection (Privacy Mode)

**File**: `mobile/src/utils/calendar.ts`

- `function detectLocalConflicts(proposedEvents, calendarEvents)` 
- Same logic as Lambda (lines 1286-1441 in assistant.js)
- Returns conflicts array
- If conflicts found, inject as local message (not sent to backend)

### 6. Mobile: Calendar Settings UI

**Files**:

- `mobile/src/screens/ChatScreen.tsx` (chat menu)
- `mobile/src/screens/ConversationListScreen.tsx` (profile/settings)

Add "Calendar Settings" option that:

- Shows current consent choice
- Allows user to change (triggers consent modal again)
- Button to "Clear & Re-select Calendars"
- Shows current permission status

### 7. Mobile: Smart Calendar Prompting

**File**: `mobile/src/screens/ChatScreen.tsx`

**Persistent Banner** (when disabled):

- If permissions denied or consent is `none`, show banner at top of chat
- Text: "📅 Calendar access disabled - Tap to enable for conflict detection"
- Tapping opens consent modal → permissions flow

**Context-Aware Prompt** (smart retrigger):

- Detect scheduling keywords in user message: `/plan|schedule|friday|monday|tuesday|wednesday|thursday|saturday|sunday|calendar|conflict|busy|free time/i`
- If consent = `none` AND keywords detected → show inline prompt before sending
- Prompt: "💡 I can check your calendar for conflicts. [Enable Calendar] [Skip]"
- Non-blocking: user can proceed without enabling

**OS Permission Recovery** (deep link):

- If OS permissions denied → banner shows "Open Settings"
- Uses `Linking.openSettings()` to jump to system calendar permissions
- **⚠️ REQUIRES TESTING**: iOS behavior differs from Android, may need `openURL('app-settings:')` or package-specific deep links

### 8. Lambda: Accept Calendar Events Parameter

**File**: `scripts/agent/assistant.js`

- Update request body parsing (line 685): extract `calendarEvents` array
- Validate structure: array of `{ startISO, endISO }`
- Log safely: `console.log('[calendar] received', calendarEvents?.length || 0, 'events')` (count only, no titles)

### 9. Lambda: Integrate into Conflict Detection

**File**: `scripts/agent/assistant.js` (lines 1286-1441)

- Expand existing conflict detection to include `calendarEvents` in `prior` array
- Mark conflicts as `{ source: 'device' }` vs `{ source: 'assistant' }`
- Output: "Friday: 9am conflict with existing event" (generic message per choice 1a)

### 10. Lambda: Include in OpenAI Context

**File**: `scripts/agent/assistant.js` (lines 1250)

- If `calendarEvents` present and `ASSISTANT_OPENAI_ENABLED`:
- Add to system message: "User's next 14 days have N occupied time slots: [list of startISO-endISO ranges]"
- Help OpenAI avoid suggesting conflicting times

### 11. Feature Flags & Rollback Strategy

**Layered Defense:**

**Mobile Flag**: `ASSISTANT_CALENDAR_READ_ENABLED` (default: `false`)

- Controls ALL calendar reading code
- Wraps: Permission requests, event reading, UI elements
- File: `mobile/app.config.ts`

**Lambda Flag**: `ASSISTANT_CALENDAR_CONFLICTS_ENABLED` (default: `false`)

- Controls backend processing of calendar events
- Lambda safely ignores `calendarEvents` if flag off
- File: Lambda environment variables

**Rollback Options:**

1. Disable mobile flag → instant rollback (5 min)
2. Disable Lambda flag → backend stops processing (30 sec)
3. User consent → individual opt-out
4. OS permissions → user control

**Backward Compatibility:**

- Lambda handles missing `calendarEvents` gracefully
- Existing calendar WRITE unchanged (separate code path)
- Non-assistant chats: zero impact

### 12. Testing & Edge Cases

- Empty calendar (no events)
- Large calendar (100+ events) → ensure performance, timeout if >5 sec
- Permission denial → banner works, deep link tested
- iOS vs Android differences → document platform quirks
- Calendar app variety (Google, Outlook, iCloud)
- Consent changes (switching from full → local → none)
- **OS Settings Deep Link** → test on real devices (iOS 15+, Android 11+)
- Race conditions: calendar read during message send
- Network failures: Lambda timeout with large payload

### 13. Documentation Updates

**File**: `_docs/Assistant_Architecture.md`

- Update flow diagram to show calendar read step
- Document privacy modes
- Note logging practices (no titles)
- List rollback procedures

## Key Files to Modify

- `mobile/app.config.ts` (iOS permissions + flags)
- `mobile/src/screens/ChatScreen.tsx` (main integration, ~80 lines)
- `mobile/src/screens/ConversationListScreen.tsx` (settings, ~20 lines)
- `mobile/src/utils/calendar.ts` (new file, ~200 lines)
- `mobile/src/components/CalendarConsentModal.tsx` (new file, ~120 lines)
- `scripts/agent/assistant.js` (backend integration, ~40 lines)
- `_docs/Assistant_Architecture.md` (documentation)

## Privacy & Security Notes

- Calendar event titles NEVER sent to backend (only time ranges)
- User explicitly chooses data sharing mode
- Local-only mode available for maximum privacy
- Lambda logs only event counts, not times or titles
- Consent can be revoked anytime
- Banner reminds user when calendar disabled

## Rollout Strategy

- Feature gated by `ASSISTANT_CALENDAR_READ_ENABLED` flag (mobile) + `ASSISTANT_CALENDAR_CONFLICTS_ENABLED` (Lambda)
- Deploy backend changes first (backward compatible)
- Deploy mobile with consent modal
- Monitor CloudWatch logs for error rates
- Collect feedback on conflict detection accuracy
- Enable for small % of users first (via remote config if available)

### To-dos

- [ ] Add iOS calendar permission strings to app.config.ts
- [ ] Create CalendarConsentModal component with three privacy options
- [ ] Build calendar.ts utility with permission requests and event reading
- [ ] Integrate calendar reading into ChatScreen assistant flow
- [ ] Implement local conflict detection for privacy mode
- [ ] Add calendar settings to chat menu and profile screen
- [ ] Add calendar disabled banner to ChatScreen
- [ ] Update Lambda to accept and validate calendarEvents parameter
- [ ] Integrate device calendar events into Lambda conflict detection
- [ ] Include calendar context in OpenAI prompts
- [ ] Test across iOS/Android, various calendar apps, and edge cases
- [ ] Update architecture documentation with calendar read flow