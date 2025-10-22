# Task List (from PRD_MVP.md)

## 🟦 Epic 1: Authentication & User Profiles
- [x] Set up AWS Cognito User Pool for signup/login — email sign-in with email verification (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Configure Cognito Identity Pool (auth-only, no guest access; federated identities if needed) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Implement signup/login UI in React Native (Expo Go) — custom in-app UI (no Hosted UI)  
- [x] Store JWT tokens securely in AsyncStorage  
- [x] Create DynamoDB table for user profiles (userId, username, avatar, status) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Implement profile fetch/update API integration (AppSync GraphQL, Cognito User Pools auth) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [x] Display username + avatar in chat header  
- [x] **Emulator Test:** Run app, verify login/signup flow and profile display  
- [x] **Update `.gitignore` / `.cursorignore`:** Ensure no Cognito config secrets, `.env` files, or Amplify-generated files are committed.  

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
- [x] **Emulator Test:** Send/receive messages, confirm real-time delivery and persistence  
- [x] **Update `.gitignore` / `.cursorignore`:** Add SQLite/AsyncStorage cache files, local debug logs, and any generated GraphQL schema files.  

---

## 🟦 Epic 3: Presence Tracking
- [x] Design presence model (User.lastSeen + AppSync subscription; 30s heartbeat, 90s threshold)  
- [x] Implement backend logic to update user online/offline state (mutation updates lastSeen)  
- [x] Subscribe to presence updates in client  
- [x] Display online/offline indicator (green dot = online, gray = offline)  
- [x] **Emulator Test:** Run two clients, confirm presence indicators update in real time  
- [x] **Update `.gitignore` / `.cursorignore`:** Exclude presence-related debug logs or temporary state dumps used during testing.  

---

## 🟦 Epic 4: Message Metadata
- [ ] Add timestamps to messages (ISO8601 format)  
- [ ] Render timestamps in chat UI under each message  
- [ ] **Emulator Test:** Verify timestamps display correctly  

---

## 🟦 Epic 5: Group Chat, Read Receipts, Notifications
- [ ] Implement basic group chat (3+ users in one conversation)  
- [ ] Add message read receipts (`READ` status)  
- [ ] Implement in-app push notifications (Expo Notifications) for new messages when chat not focused  
- [ ] Attribute messages by sender; show participants list and avatars in header  
- [ ] Persist and sync group messages offline/online; optimistic UI for send  
- [ ] **Emulator Test:** 3+ participants, offline/online transitions, rapid-fire (20+), background delivery  

---

## 🟦 Epic 6: Non-Functional Requirements
- [ ] Ensure all API calls require Cognito JWT authentication  
- [ ] Test optimistic UI latency (<200ms target)  
- [ ] Validate message persistence across app restarts  
- [ ] Test offline mode (send/receive after reconnect)  
- [ ] Emulator testing on Android Virtual Device (Pixel 5, Android 13)  
- [ ] **Emulator Test:** Restart and offline scenarios  
- [ ] **Update `.gitignore` / `.cursorignore`:** Add emulator build artifacts, crash reports, and Expo debug logs.  

---

## 🟦 Epic 7: Testing & QA
- [ ] Write unit tests for authentication flow  
- [ ] Write unit tests for message send/receive  
- [ ] Write integration tests for AppSync + DynamoDB (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [ ] Test edge cases: offline mode, app restart, network reconnection  
- [ ] Document test cases in QA checklist  
- [ ] **Emulator Test:** Full end-to-end flow (login → chat → presence → restart → offline → reconnect)  
- [ ] **Update `.gitignore` / `.cursorignore`:** Exclude test coverage reports, snapshots, and temporary QA scripts.  

---

## 🟦 Future Enhancements (Backlog)
- [ ] Add media/file sharing (S3 integration) (Reminder: set `$env:AWS_PROFILE='ciscodg@gmail'`)  
- [ ] Add typing indicators  
- [ ] **Update `.gitignore` / `.cursorignore`:** Add notification service configs, S3 upload temp files, and experimental feature branches.  
