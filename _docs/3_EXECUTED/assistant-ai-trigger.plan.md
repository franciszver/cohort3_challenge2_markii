# Assistant @Ai Trigger Implementation (Smart Solo/Multi-User)

## Core Logic

**Solo mode (≤2 senders):** Assistant responds to ALL messages, @Ai prefix stripped if present
**Multi-user mode (>2 senders):** Assistant only responds to @Ai messages, prefix kept

## Changes Required

### 1. Update onSend logic with solo/multi-user detection

In `ChatScreen.tsx` onSend function (lines 645-774):

```typescript
// Count unique senders from participantIds (includes assistant-bot)
const isMultiUser = participantIds.length > 2;
const isAiMention = /^@ai\b/i.test(trimmed);
const isAssistantConvo = ASSISTANT_ENABLED && (providedConversationId || '').startsWith('assistant::');

let messageText = trimmed;
let shouldTriggerAssistant = false;

if (isAssistantConvo) {
  if (isMultiUser) {
    // Multi-user: require @Ai, keep prefix
    shouldTriggerAssistant = isAiMention;
  } else {
    // Solo: always trigger, strip @Ai if present
    shouldTriggerAssistant = true;
    if (isAiMention) {
      messageText = trimmed.replace(/^@ai\s*/i, '');
    }
  }
}

// Use messageText for optimistic message and sendTextMessageCompat
// Only call assistant endpoint if shouldTriggerAssistant === true
```

### 2. Visual "→ AI" badge (multi-user mode only)

In message render (lines 906-961), after timestamp (around line 945-955):

- Check: `isMultiUser && /^@ai\b/i.test(item.content)`
- Add: `<Text style={{ color: theme.colors.textSecondary }}> → AI</Text>`
- Only show in multi-user mode (when >2 senders)

### 3. Conditional placeholder hint

Update TextInput placeholder (line 1218):

```typescript
const isAssistantConvo = (providedConversationId || '').startsWith('assistant::');
const isMultiUser = participantIds.length > 2;
const placeholderText = isAssistantConvo && isMultiUser ? "@Ai for assistant" : "Message";

placeholder={placeholderText}
```

### 4. Update "AI is responding..." indicator

Change line 856 text from "Assistant is thinking…" to "AI is responding…"

Show in both solo and multi-user mode whenever assistant is processing.

### 5. Transition system message

When participant count changes from ≤2 to >2, insert a local system-style message:

```typescript
// In subscription or when participantIds updates
// Track previous count in a ref
if (prevCount <= 2 && participantIds.length > 2) {
  // Insert local UI-only message (not sent to backend)
  const systemMsg = {
    id: `system-${Date.now()}`,
    content: "💡 Now that others joined, use @Ai to ask assistant",
    senderId: 'system',
    createdAt: new Date().toISOString(),
    _isSystemMsg: true
  };
  setMessages(prev => [systemMsg, ...prev]);
}
```

Render system messages with centered, muted styling.

## Implementation Notes

- `participantIds` is already computed from latest 50 messages (lines 419-424)
- Count includes `assistant-bot` as a sender
- Solo: 1 user + assistant-bot = 2 senders
- Multi: 1+ users + assistant-bot = 3+ senders
- Strip @Ai using regex: `trimmed.replace(/^@ai\s*/i, '')`

## Files Modified

- `mobile/src/screens/ChatScreen.tsx` - all changes

## Testing

1. **Solo mode**: Create assistant convo, send "hello" → AI responds
2. **Solo mode**: Send "@Ai hello" → AI responds, @Ai stripped from message
3. **Add 2nd user**: Verify system message appears
4. **Multi mode**: Send "hello" → no AI response
5. **Multi mode**: Send "@Ai hello" → AI responds, @Ai kept in message
6. **Multi mode**: Verify "→ AI" badge appears on @Ai messages only
7. **Multi mode**: Verify placeholder shows "@Ai for assistant"

## To-dos

- [ ] Add solo/multi-user detection and conditional @Ai triggering in onSend
- [ ] Strip @Ai prefix in solo mode before sending message
- [ ] Add → AI badge to @Ai messages in multi-user mode only
- [ ] Update placeholder to show @Ai hint only in multi-user mode
- [ ] Change thinking indicator to 'AI is responding...'
- [ ] Insert system message when conversation transitions to multi-user

