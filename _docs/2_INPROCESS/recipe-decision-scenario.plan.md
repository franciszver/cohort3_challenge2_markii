<!-- 0e03aa17-d879-4aaa-961b-6dfd65a776e1 8836b0ba-5666-44e6-bf45-d0eb3b5f6a05 -->
# Recipe Decision Scenario Implementation

## Overview

Enable the recipe scenario where family members express food preferences (e.g., "I want chicken", "I want chinese"), and the Assistant synthesizes these into recipe suggestions when asked "What should I make?".

## Implementation Steps

### 1. Auto-tag food preferences as decisions (Lambda)

**File:** `scripts/agent/assistant.js`

**Location:** After message is processed, before assistant reply (around line 1210-1232 where decision auto-save exists)

**Add pattern matching for food preferences:**

```javascript
// Extract food preferences and auto-tag as decisions
const foodPatterns = [
  /\b(?:i|we)\s+want\s+([a-z]+)\b/i,
  /\blet'?s\s+have\s+([a-z]+)\b/i,
  /\bhow\s+about\s+([a-z]+)\b/i,
  /\b(?:prefer|like|love)\s+([a-z]+)\b/i,
];
for (const pattern of foodPatterns) {
  const match = pattern.exec(text || '');
  if (match && match[1]) {
    const food = match[1].toLowerCase();
    const decision = {
      title: `Preference: ${food}`,
      summary: text.slice(0, 200),
      participants: [userId],
      decidedAtISO: new Date().toISOString(),
      type: 'food_preference',
      keyword: food,
    };
    const payload = JSON.stringify({ decisions: [decision] });
    await createSystemMetadataMessage(conversationId, jwt, { decisions: [decision] }, '[assistant:decisions] decisions:' + payload, ['decisions:' + payload]);
    logMetric('food_preference_tagged', 1);
  }
}
```

### 2. Enhance recipe fetching with multi-keyword support (Lambda)

**File:** `scripts/agent/assistant.js`

**Location:** Update `fetchRecipes` function (lines 586-635)

**Changes:**

- Accept array of keywords instead of single hint
- Try comma-separated search first
- Fallback to individual keyword searches and merge results
- Deduplicate by meal ID
```javascript
async function fetchRecipes({ prefs, keywords = [], budgetMs = 3500 }) {
  // ... existing vegetarian check ...
  
  if (!list.length && keywords.length) {
    // Try comma-separated keywords first
    try {
      const combined = keywords.join(',');
      const res = await httpGetJson({ 
        host: 'www.themealdb.com', 
        path: `/api/json/v1/1/filter.php?i=${encodeURIComponent(combined)}`,
        timeoutMs: await timeLeft() 
      });
      list = Array.isArray(res?.meals) ? res.meals.slice(0, 6) : [];
    } catch {}
    
    // Fallback: try each keyword separately and merge
    if (!list.length) {
      const seen = new Set();
      for (const kw of keywords) {
        try {
          const res = await httpGetJson({ 
            host: 'www.themealdb.com', 
            path: `/api/json/v1/1/filter.php?i=${encodeURIComponent(kw)}`,
            timeoutMs: await timeLeft() 
          });
          const meals = Array.isArray(res?.meals) ? res.meals : [];
          for (const m of meals) {
            if (!seen.has(m.idMeal)) {
              seen.add(m.idMeal);
              list.push(m);
            }
          }
        } catch {}
      }
    }
  }
  
  // ... rest of function (fetch details) ...
}
```


### 3. Scan for food preferences when recipe requested (Lambda)

**File:** `scripts/agent/assistant.js`

**Location:** In dinner intent handler (lines 1187-1208)

**Add decision + message scanning:**

```javascript
if (dinnerIntent) {
  try {
    // Collect food preferences from decisions AND recent messages
    const foodKeywords = new Set();
    
    // 1. Scan tagged decisions for food preferences
    try {
      const sys = await getRecentSystemMessages(conversationId, jwt, 200);
      for (const m of sys) {
        const meta = toObjectJson(m?.metadata);
        if (Array.isArray(meta?.decisions)) {
          for (const d of meta.decisions) {
            if (d.type === 'food_preference' && d.keyword) {
              foodKeywords.add(d.keyword.toLowerCase());
            }
          }
        }
      }
    } catch {}
    
    // 2. Scan recent messages for untagged preferences
    const foodPatterns = [
      /\b(?:i|we)\s+want\s+([a-z]+)\b/gi,
      /\blet'?s\s+have\s+([a-z]+)\b/gi,
      /\bhow\s+about\s+([a-z]+)\b/gi,
      /\b(?:prefer|like|love)\s+([a-z]+)\b/gi,
    ];
    for (const msg of recent) {
      const txt = String(msg?.content || '');
      for (const pattern of foodPatterns) {
        const matches = txt.matchAll(pattern);
        for (const match of matches) {
          if (match[1]) foodKeywords.add(match[1].toLowerCase());
        }
      }
    }
    
    const keywords = Array.from(foodKeywords);
    const prefs = await loadLatestPreferences(conversationId, jwt);
    const recs = await fetchRecipes({ prefs, keywords, budgetMs: 3500 });
    
    if (Array.isArray(recs) && recs.length) {
      const prefsSummary = keywords.length ? `Based on preferences (${keywords.join(', ')}), here are some suggestions:` : 'Here are some dinner ideas:';
      const recTitles = recs.map(r => `• ${r.title}`).join('\n');
      const content = `${ASSISTANT_REPLY_PREFIX} ${prefsSummary}\n${recTitles}`;
      
      const attachRecipes = 'recipes:' + JSON.stringify({ recipes: recs });
      const metadata = { recipes: recs };
      
      await createAssistantMessage(conversationId, content, jwt, metadata, [attachRecipes], 'TEXT');
      return respond(isHttp, 200, { ok: true });
    }
  } catch {}
  // fallback to existing OpenAI flow...
}
```

### 4. Add "View Recipes" CTA button in mobile (ChatScreen)

**File:** `mobile/src/screens/ChatScreen.tsx`

**Location:** Message render section (around lines 998-1021)

**Add recipes CTA after message content:**

```typescript
{(() => {
  try {
    const { ASSISTANT_RECIPE_ENABLED } = getFlags();
    if (!ASSISTANT_RECIPE_ENABLED || item.senderId !== 'assistant-bot') return null;
    
    const meta = (() => { 
      try { 
        return typeof item.metadata === 'string' ? JSON.parse(item.metadata) : (item.metadata || {}); 
      } catch { 
        return {}; 
      } 
    })();
    
    if (!Array.isArray(meta?.recipes) || !meta.recipes.length) return null;
    
    return (
      <TouchableOpacity
        style={{ 
          marginTop: 8, 
          paddingVertical: 6, 
          paddingHorizontal: 12, 
          backgroundColor: theme.colors.primary, 
          borderRadius: 8 
        }}
        onPress={() => {
          setRecipesItems(meta.recipes);
          setRecipesVisible(true);
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '600', textAlign: 'center' }}>
          View Recipes ({meta.recipes.length})
        </Text>
      </TouchableOpacity>
    );
  } catch {
    return null;
  }
})()}
```

### 5. Enable ASSISTANT_RECIPE_ENABLED flag

**File:** `scripts/agent/deploy.ps1`

**Update:** Ensure `-EnableRecipes` switch sets the env var (already exists at lines 9, 42, 49)

**Deploy command example:**

```powershell
.\scripts\agent\deploy.ps1 `
  -Profile your-profile `
  -Region us-east-1 `
  -AppSyncApiId xxxxx `
  -AppSyncEndpoint https://xxxxx.appsync-api.us-east-1.amazonaws.com/graphql `
  -EnableOpenAI `
  -EnableRecipes `
  -EnableDecisions `
  -OpenAIApiKey sk-...
```

### 6. Add ASSISTANT_RECIPE_ENABLED flag to mobile

**File:** `mobile/src/utils/flags.ts`

**Add flag:**

```typescript
ASSISTANT_RECIPE_ENABLED: __DEV__ ? true : false,
```

## Testing Flow

1. **Setup:** Create assistant conversation with Mother + Kid1 + Kid2
2. **Kid1 messages:** "@Ai I want chicken"

   - Verify: Decision auto-tagged with type='food_preference', keyword='chicken'

3. **Kid2 messages:** "@Ai I want chinese"

   - Verify: Decision auto-tagged with type='food_preference', keyword='chinese'

4. **Mother asks:** "@Ai What should I make?"

   - Verify: Assistant scans decisions + recent messages
   - Verify: Response includes "Based on preferences (chicken, chinese)"
   - Verify: 1-3 recipe titles listed in message
   - Verify: "View Recipes" button appears on mobile

5. **Click "View Recipes"**

   - Verify: Modal shows recipe titles, ingredients, steps

6. **Fallback test:** Ask recipe question without prior preferences

   - Verify: Falls back to default (chicken) or OpenAI response

## Files Modified

- `scripts/agent/assistant.js` - food tagging, recipe fetching, dinner intent handler
- `mobile/src/screens/ChatScreen.tsx` - "View Recipes" CTA button
- `mobile/src/utils/flags.ts` - ASSISTANT_RECIPE_ENABLED flag
- `scripts/agent/deploy.ps1` - (already has -EnableRecipes flag)

## Edge Cases

- **No preferences found:** Fall back to generic recipes or OpenAI suggestion
- **Invalid keywords:** TheMealDB returns empty, try default ingredient
- **Mixed preferences:** Extract all keywords, let API filter handle combination
- **Non-food "I want" statements:** May create false positives; acceptable for MVP

### To-dos

- [ ] Add food preference pattern matching and auto-tagging as decisions in assistant.js
- [ ] Enhance fetchRecipes to accept keyword array, try comma-separated then individual fallback
- [ ] Update dinner intent handler to scan tagged decisions + recent messages for food keywords
- [ ] Add 'View Recipes' CTA button in ChatScreen for assistant messages with recipes metadata
- [ ] Test full scenario: Kid1 wants chicken, Kid2 wants chinese, Mother asks for recipe