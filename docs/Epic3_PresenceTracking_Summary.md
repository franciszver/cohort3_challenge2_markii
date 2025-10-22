## Epic 3: Presence Tracking - Summary

### Decision
- Presence is tracked per user via `User.lastSeen`.
- Clients send a heartbeat every 30s when foregrounded and opportunistically on user actions (e.g., send message, focus app).
- Online = now − lastSeen < 90s. Otherwise offline.
- Clients subscribe to `onUpdateUser` for specific counterpart `userId` to receive updates in real time.

### Why this approach
- Simple and robust: no custom socket infra; uses AppSync + DynamoDB only.
- Battery/network friendly: 30s cadence balances freshness and cost.
- Works offline: the indicator naturally flips to offline without heartbeats.
- Easy to extend later to “contacts only” visibility with auth rules.

### Client responsibilities
- On sign-in and app foreground, start a 30s interval to call the update mutation (update `lastSeen`).
- On key actions (send message, open chat), perform an immediate `lastSeen` update.
- Subscribe to `onUpdateUser` filtered by the counterpart `userId` and compute online status client-side using the 90s threshold.

### Backend responsibilities
- Ensure `User` type includes `lastSeen: AWSDateTime` and an update mutation.
- No additional tables required. No TTL necessary for MVP.

### Testing checklist
- Two devices/accounts: ensure indicator flips to green within ~30–60s after the other user opens the app.
- Background one device: indicator goes gray within ~90–120s.
- Network loss: indicator eventually turns gray; recovers to green after reconnect + next heartbeat.
- Send message from one device: confirm an opportunistic update refreshes presence promptly.

### Future improvements
- Reduce threshold or cadence for more responsiveness if needed.
- Restrict presence reads to conversation participants with additional auth rules.
- Add server-side metrics or alarms if heartbeats fail repeatedly.


