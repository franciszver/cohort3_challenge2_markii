## Assistant Architecture (Current, Flag-Gated)

```mermaid
graph TD
  subgraph Mobile App (Expo React Native)
    A1[ConversationListScreen]
    A2[ChatScreen]
    A3[Flags: ASSISTANT_ENABLED, ASSISTANT_CALENDAR_ENABLED, ...]
    A4[expo-calendar]
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

  A2 -- send chat in assistant convo --> B1
  B1 --> B2
  B2 -- read last ~10 msgs --> B3
  B3 -- query --> B4
  B2 -- optional key --> B5
  B2 -- if dinner intent --> C2
  B2 -- if OpenAI flag --> C1
  B2 -- create assistant reply (text + metadata) --> B3
  B3 -- subscription update --> A2
  A2 -- parse metadata.events / attachments --> A4

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
  Mobile->>APIGW: POST /agent/weekend-plan {conversationId, userId, text, jwt}
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
- Message metadata: `metadata.events`, `metadata.recipes`; attachment sentinels `events:{...}`, `recipes:{...}`.
- Preferences & lists: SYSTEM messages with `metadata.type` and attachment tokens (`pref:{...}`, `list:{...}`).
- Flags ensure non-breaking rollout; off = legacy behavior.

### Reliability & Safety
- Timeouts: AppSync ~4s, OpenAI 6s, recipes ~3.5s.
- Strict JSON validation; idempotency via in-memory request dedup.
- Fallback to template with `events[]` on any error.


