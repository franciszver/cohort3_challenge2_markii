# Task List (from PRD_MVP.md)

## 🟦 Epic 1: Authentication & User Profiles
- [x] Set up AWS Cognito User Pool for signup/login — email sign-in with email verification (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Configure Cognito Identity Pool (auth-only, no guest access; federated identities if needed) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Implement signup/login UI in React Native (Expo Go) — custom in-app UI (no Hosted UI)  
- [x] Store JWT tokens securely in AsyncStorage  
- [x] Create DynamoDB table for user profiles (userId, username, avatar, status) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Implement profile fetch/update API integration (AppSync GraphQL, Cognito User Pools auth) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Display username + avatar in chat header  
 

---

## 🟦 Epic 2: Messaging (One-on-One, Real-Time)
- [x] Define GraphQL schema for messages (AppSync) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Create DynamoDB table for messages (messageId, senderId, receiverId, content, timestamp, status) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Implement GraphQL mutations for sending messages (AppSync) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Implement GraphQL subscriptions for receiving messages in real time (AppSync) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Build chat UI (message bubbles, input box, send button)  
- [x] Add optimistic UI updates (show message instantly with `PENDING` status)  
- [x] Update message status once confirmed by server (`SENT`, `DELIVERED`)  
- [x] Implement local cache (AsyncStorage/SQLite) for offline persistence  
- [x] Sync local cache with DynamoDB/AppSync on reconnect (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
 

---

## 🟦 Epic 3: Presence Tracking
- [x] Design presence model (User.lastSeen + AppSync subscription; 30s heartbeat, 90s threshold)  
- [x] Implement backend logic to update user online/offline state (mutation updates lastSeen)  
- [x] Subscribe to presence updates in client  
- [x] Display online/offline indicator (green dot = online, gray = offline)  
 

---

## 🟦 Epic 4: Message Metadata
- [x] Add timestamps to messages (ISO8601 format)  
- [x] Render timestamps in chat UI under each message  
 

---

## 🟦 Epic 5: Group Chat, Read Receipts, Notifications
- [x] Implement basic group chat (3+ users in one conversation)  
- [x] Add message read receipts (`READ` status)  
- [x] Implement in-app push notifications (Expo Notifications) for new messages when chat not focused  
- [x] Attribute messages by sender  
- [ ] Show participants list and avatars in chat header (groups)  
- [x] Persist and sync group messages offline/online; optimistic UI for send  
 

---

## 🟦 Epic 6: Hardening & Backlog
- [x] Ensure all API calls require Cognito JWT authentication  
- [x] Validate message persistence across app restarts  
- [ ] Add rich link previews (OpenGraph/Twitter Cards link unfurling)  
- [x] Add typing indicators  
- [x] Consolidate `.gitignore` / `.cursorignore` updates (secrets, generated files, caches/logs, emulator artifacts, test coverage)  
