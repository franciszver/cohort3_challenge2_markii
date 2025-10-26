## Assistant Architecture (Current, Flag-Gated)

```mermaid
graph TD
  subgraph Mobile App (Expo React Native)
    A1[ConversationListScreen]
    A2[ChatScreen]
    A3[Flags: ASSISTANT_ENABLED, ASSISTANT_CALENDAR_READ_ENABLED, ...]
    A4[expo-calendar]
    A5[Calendar Consent Modal\nfull/local/none]
  end

  subgraph AWS
    B1[API Gateway\nPOST /agent/weekend-plan]
    B2[Lambda: assistant-mvp\n(scripts/agent/assistant.js)]
    B3[AppSync GraphQL API]
    B4[(DynamoDB tables)\nmessages, user_profiles]
    B5[AWS Secrets Manager\nOPENAI_SECRET_ARN]
  end

  subgraph External Services (Flagged)
    C1[OpenAI Chat Completions\n(6s timeout)\nASSISTANT_OPENAI_ENABLED]
    C2[Themealdb API\n(~3.5s budget)\nASSISTANT_RECIPE_ENABLED]
  end

  A2 -- read calendar events (next 14 days) --> A4
  A2 -- send chat + calendarEvents (if full mode) --> B1
  B1 --> B2
  B2 -- read last ~10 msgs --> B3
  B3 -- query --> B4
  B2 -- optional key --> B5
  B2 -- if dinner intent --> C2
  B2 -- if OpenAI flag + calendar data --> C1
  B2 -- detect conflicts (assistant + device events) --> B2
  B2 -- create assistant reply (text + metadata) --> B3
  B3 -- subscription update --> A2
  A2 -- parse metadata.events / attachments --> A4
  A2 -- local conflict detection (if local mode) --> A2

  classDef flag fill:#eef,stroke:#66f,stroke-width:1px;
  C1:::flag
  C2:::flag
```

### Primary Flow (Sequence)

```mermaid
sequenceDiagram
  participant User
  participant Mobile as Mobile (ChatScreen)
  participant APIGW as API Gateway
  participant Lambda as Lambda assistant-mvp
  participant AppSync as AppSync GraphQL
  participant DB as DynamoDB
  participant OpenAI as OpenAI (flag)
  participant Meals as Themealdb (flag)

  User->>Mobile: Send message to assistant conversation
  alt ASSISTANT_CALENDAR_READ_ENABLED
    Mobile->>Mobile: Read calendar events (next 14 days, no titles)
  end
  Mobile->>APIGW: POST /agent/weekend-plan {conversationId, userId, text, jwt, calendarEvents?}
  APIGW->>Lambda: Invoke handler
  Lambda->>AppSync: messagesByConversationIdAndCreatedAt (last ~10)
  AppSync->>DB: query messages
  DB-->>AppSync: items
  AppSync-->>Lambda: messages
  alt ASSISTANT_RECIPE_ENABLED & dinner intent
    Lambda->>Meals: fetch recipes (<=3.5s)
    Meals-->>Lambda: 1–3 recipes
    Lambda->>AppSync: createMessage (metadata.recipes + recipes:{...})
  else ASSISTANT_OPENAI_ENABLED
    Lambda->>OpenAI: chat.completions (<=6s)
    OpenAI-->>Lambda: JSON { text, events?[] }
    Lambda->>AppSync: createMessage (text, metadata.events + events:{...})
  else fallback
    Lambda->>AppSync: createMessage (template + events[])
  end
  AppSync-->>Mobile: subscription on new message
  Mobile->>Mobile: render message; show CTAs (calendar / recipes)
  Mobile->>expo-calendar: write events (on CTA) after permission
```

### Key Contracts
- Message metadata: `metadata.events`, `metadata.recipes`, `metadata.conflicts`; attachment sentinels `events:{...}`, `recipes:{...}`, `conflicts:{...}`.
- Preferences & lists: SYSTEM messages with `metadata.type` and attachment tokens (`pref:{...}`, `list:{...}`).
- Calendar events: Request includes `calendarEvents: [{startISO, endISO}]` (no titles for privacy).
- Conflict detection: Lambda checks proposed events against assistant history + device calendar events.
- Flags ensure non-breaking rollout; off = legacy behavior.

### Privacy & Calendar Access
- **Three consent modes:**
  - `full`: Calendar events (time ranges only, no titles) sent to Lambda/OpenAI for smart planning
  - `local`: Calendar events processed locally on device for conflict warnings only
  - `none`: No calendar access
- User explicitly chooses mode via consent modal (first time + retriggerable via settings)
- Calendar event titles NEVER sent to backend (only `startISO` and `endISO`)
- Lambda logs only event count, never times or titles
- Banner shown when calendar access disabled with tap-to-enable

### Reliability & Safety
- Timeouts: AppSync ~4s, OpenAI 6s, recipes ~3.5s, calendar read ~5s (auto-skip on timeout).
- Strict JSON validation; idempotency via in-memory request dedup.
- Fallback to template with `events[]` on any error.
- Calendar permissions handled gracefully; feature degrades if denied.

### Rollback Procedures
- **Mobile flag**: `ASSISTANT_CALENDAR_READ_ENABLED=false` → instant disable (5 min deployment)
- **Lambda flag**: `ASSISTANT_CALENDAR_CONFLICTS_ENABLED=false` → backend ignores calendar data (30 sec)
- **User consent**: Individual opt-out via settings or banner
- **OS permissions**: User can revoke at system level
- No breaking changes to existing assistant functionality when flags off


