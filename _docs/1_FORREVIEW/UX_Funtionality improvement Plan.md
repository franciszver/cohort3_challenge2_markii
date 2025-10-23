## UX / Functionality Improvement Plan

Scope: Mobile app (`mobile/`) UX and resiliency improvements. Arranged by priority for incremental delivery with quick manual verification after each task.

Priority Legend:
- P0: Must-have now (foundational UX/resilience)
- P1: High-impact next (core messaging UX)
- P2: Important (quality and adoption)
- P3: Nice-to-have or backend-dependent

Implementation notes:
- Use consistent UI patterns across screens (`mobile/src/screens/*`) and shared components.
- Prefer small, atomic PRs: 1–3 tasks per PR, each manually verified.
- Surfaces to update will often include `AuthScreen.tsx`, `VerifyCodeScreen.tsx`, `ForgotPassword*Screen.tsx`, `ConversationListScreen.tsx`, `ChatScreen.tsx`, and `HomeScreen.tsx`.

---

### Epic P0.1 — Seamless Auth Flow (auto-redirect, reduced screen hops)
Goal: Remove friction during sign-in and unify verification/reset flows.

Dependencies: Amplify Auth configuration (`mobile/src/aws.ts`), navigation root (`mobile/App.tsx`, `mobile/src/screens/*`).

Tasks
1) Auto-redirect if already signed in on app start (P0)
   - Implement an auth gate in app root to check current session and navigate to `HomeScreen`/`ConversationListScreen`.
   - Persist intended deep link and resume post-auth.
   - Acceptance: Launch app while signed in → lands on conversations without flicker; signed out → lands on auth.

2) Unify email verification into sign-in flow (P0)
   - From `SignInScreen`, detect unverified users; show inline CTA to resend code and navigate to `VerifyCodeScreen` only when needed.
   - Acceptance: Attempt sign-in with unverified user → see inline message, can resend and verify with minimal hops.

3) Streamline forgot password flow (P0)
   - Combine request + code + new password into a linear flow with minimal screen transitions; pre-fill username/email.
   - Acceptance: Start from Sign In → reset password end-to-end with at most 2 transitions.

4) Centralize auth error mapping (P0)
   - Map common Amplify/Auth errors to user-friendly messages and return UI-safe strings to Toast layer.
   - Acceptance: Known errors display consistent, readable copy; unknowns show generic fallback.

5) Test (P0)
   - Launch while already signed in → lands on conversations without flicker.
   - Sign out, relaunch → lands on auth.
   - Attempt sign-in with unverified user → see inline verify prompt, resend code, verify, continue.
   - Run forgot password → request code, enter code, set new password in one linear flow.

---

### Epic P0.2 — Toasts/Snackbars (consistent success/error notifications)
Goal: Provide immediate, consistent feedback for auth, profile, messaging.

Dependencies: UI library for toast/snackbar; shared notifier utility.

Tasks
1) Create `useNotifier` hook and provider (P0)
   - Expose `notifySuccess`, `notifyError`, `notifyInfo` with standard duration and placement.
   - Acceptance: Can trigger toasts from any screen with consistent style.

2) Wire to auth flows (P0)
   - Show success on sign-in/out, verification, password reset; errors through mapped messages.
   - Acceptance: Each auth action shows one, non-duplicated toast.

3) Wire to messaging actions (P0)
   - Show send failure, retry success, and profile update success.
   - Acceptance: Sending error produces clear toast; retry success shows a single success toast.

4) Test (P0)
   - Sign in successfully → see success toast.
   - Enter wrong password → see error toast with friendly copy.
   - Complete password reset → see success toast.
   - In chat, simulate send failure → error toast; tap retry → single success toast.

---

### Epic P0.3 — Error Boundaries and Empty States
Goal: Prevent blank screens, guide users when there’s no data or errors.

Dependencies: Global error boundary component; list empty-state components.

Tasks
1) Global error boundary wrapper (P0)
   - Wrap app root to catch rendering errors; show recovery CTA (restart/navigation home).
   - Acceptance: Simulated throw in child renders friendly recovery UI.

2) Empty states for conversations and messages (P0)
   - Add friendly illustrations/text and primary actions (start conversation, send first message).
   - Acceptance: No data shows empty state; data appears correctly once loaded.

3) Network error state (P0)
   - Show offline banner and retry CTA when queries fail.
   - Acceptance: Airplane mode displays banner; retry hides when back online.

4) Test (P0)
   - Enable airplane mode and open conversation list → offline banner appears.
   - Disable airplane mode and tap retry → banner hides after reconnect.
   - Visit conversations/messages with no data → friendly empty state with CTA.
   - Trigger a test error in a screen → global error boundary with recovery CTA shows.

---

### Epic P0.4 — Skeletons and Loaders (shimmer placeholders, inline spinners)
Goal: Improve perceived performance during fetches and actions.

Dependencies: Skeleton component(s); button loader pattern.

Tasks
1) Add reusable skeleton components (P0)
   - Conversation list item skeleton; message bubble skeleton.
   - Acceptance: While fetching lists, skeletons show with shimmer and correct spacing.

2) Inline button spinners (P0)
   - For primary actions (Sign In, Reset, Send), disable + show inline spinner.
   - Acceptance: Buttons show spinner during async; re-enable after completion.

3) Test (P0)
   - Cold start conversation list → skeletons visible until data renders.
   - Open a chat and press Send on a slow network → button shows spinner, then clears on completion.

---

### Epic P1.1 — Optimistic Sends + Retries + Offline Queue
Goal: Make messaging feel instant and resilient to transient failures/offline.

Dependencies: Message store abstraction; network status listener; durable queue storage.

Tasks
1) Optimistic message rendering (P1)
   - Render outgoing message immediately with local temp ID, status = sending.
   - Acceptance: New message appears instantly; on success it reconciles to server ID.

2) Retry policy with backoff (P1)
   - Auto-retry failed sends with exponential backoff; show retry icon + tap-to-retry.
   - Acceptance: Induced failure retries up to N times; manual retry works.

3) Offline queue (P1)
   - Queue messages when offline; auto-flush on reconnect in order.
   - Acceptance: Airplane mode → send queues; upon reconnect they send in sequence.

4) Status indicators (P1)
   - Show per-message status: sending, sent, failed.
   - Acceptance: Visual statuses are accurate and update in real time.

5) Test (P1)
   - Send a message online → appears immediately as "sending", then transitions to "sent".
   - Enable airplane mode, send two messages → they queue; disable airplane → they flush in order.
   - Induce a send failure → observe auto-retries up to N; tap retry icon to send immediately.

---

### Epic P1.2 — Pagination and Pull-to-Refresh
Goal: Efficient list loading for conversations and messages.

Dependencies: GraphQL queries with `limit`/`nextToken` (`mobile/src/graphql/*`).

Tasks
1) Infinite scroll for conversations (P1)
   - Append more on scroll end; dedupe; maintain scroll position.
   - Acceptance: Smoothly loads additional pages with no jumpiness.

2) Infinite scroll / reverse pagination for messages (P1)
   - Load older messages on scroll to top while maintaining viewport.
   - Acceptance: Backfilling older pages keeps current message in view.

3) Pull-to-refresh on both lists (P1)
   - Force refetch latest; reset pagination tokens.
   - Acceptance: Pull refreshes top-of-list data; tokens reset correctly.

4) Test (P1)
   - Scroll conversation list to bottom → next page loads smoothly without duplicates.
   - In chat, scroll to top → older messages load while keeping viewport anchor stable.
   - Pull-to-refresh at top of both lists → latest data loads; pagination tokens reset (no gaps).

---

### Epic P2.1 — Profile Completion Nudge
Goal: Encourage users to complete profile post-signup and in header until done.

Dependencies: Profile schema and fetch (`mobile/src/graphql/profile.ts`).

Tasks
1) Detect incomplete profile (P2)
   - Define completeness criteria (e.g., display name + avatar).
   - Acceptance: Users missing fields are flagged consistently.

2) Post-signup prompt and header nudge (P2)
   - Inline banner/CTA to `ProfileSetupScreen` until completed; snooze option.
   - Acceptance: Prompt appears only when incomplete; disappears after completion.

3) Test (P2)
   - Sign up/log in with incomplete profile → nudge appears; tap to open setup.
   - Complete profile (display name + avatar) → nudge disappears on return.
   - If snooze is present → snooze hides nudge for current session.

---

### Epic P2.2 — Push Notifications (new messages, mentions, deep links)
Goal: Re-engage users and deep-link into threads.

Dependencies: Push provider (Expo Notifications or FCM/APNs), backend subscription/trigger, deep link config.

Tasks
1) Register device and request permissions (P2)
   - Store push token with user profile; handle permission denial path.
   - Acceptance: Token captured on first run; denial handled gracefully.

2) Receive notification and deep-link (P2)
   - Navigate to conversation/message on tap; handle app-cold/warm states.
   - Acceptance: Tapping notification opens correct thread from background/quit states.

3) New message and mention triggers (P2)
   - Subscribe on backend and send targeted pushes; handle badge count.
   - Acceptance: Sender → recipient receives push; mention also triggers.

4) Test (P2)
   - Allow notifications on first run → verify device token is captured (via debug/log or profile field).
   - From another device/user, send a new message → push arrives; tap → deep-links to correct thread from background/quit.
   - Mention the user in a message → mention notification arrives.

---

### Epic P3.1 — Presence and Typing Indicators
Goal: Real-time presence (online) and per-thread typing indicators.

Dependencies: Backend support (e.g., AppSync subscriptions / WebSocket presence channel).

Tasks
1) Presence badges in conversation list and chat header (P3)
   - Show online/last seen; degrade gracefully if unavailable.
   - Acceptance: Presence updates reflect subscription events.

2) Typing indicators (P3)
   - Emit typing start/stop; show "typing…" in thread.
   - Acceptance: Two-device test shows indicator within <1s latency.

3) Test (P3)
   - Open same conversation on two devices → presence badge reflects online/last seen correctly.
   - Begin typing on device A → device B shows "typing…" within ~1s; stop typing → indicator clears after inactivity.

---

### Epic P3.2 — Settings Screen (debug-friendly)
Goal: Central place for notification toggles, sign-out, region/environment info.

Dependencies: Existing auth and notification settings.

Tasks
1) Create `SettingsScreen` with sections (P3)
   - Notification toggle, sign-out button, environment/region display, version/build info.
   - Acceptance: Screen accessible from header; sign-out works; toggles persist.

2) Deep link to settings (P3)
   - Add deep link for quick access during testing/debugging.
   - Acceptance: Opening settings link navigates correctly from any state.

3) Test (P3)
   - Open Settings → environment/region and app version are shown.
   - Toggle notifications → state persists after app restart.
   - Tap Sign Out → returns to auth; sign back in successfully.

---

## Delivery Order (by Epic)
1) P0.1 Seamless Auth Flow
2) P0.2 Toasts/Snackbars
3) P0.3 Error Boundaries and Empty States
4) P0.4 Skeletons and Loaders
5) P1.1 Optimistic Sends + Retries + Offline Queue
6) P1.2 Pagination and Pull-to-Refresh
7) P2.1 Profile Completion Nudge
8) P2.2 Push Notifications
9) P3.1 Presence and Typing Indicators
10) P3.2 Settings Screen

## Definition of Done (per task)
- UI adheres to shared styles and accessibility basics.
- Errors routed through centralized notifier with friendly copy.
- Minimal, targeted logs for failure diagnosis.
- Manual test steps executed and outcomes recorded in PR description.

