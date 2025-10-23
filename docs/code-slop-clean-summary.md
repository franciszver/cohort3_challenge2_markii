# Code Slop Clean Summary

Scope: dev branch, last 4 days. Unused screens/components, duplicate flows, and unused GraphQL helpers removed without changing visible behavior.

Removed files
- `mobile/src/screens/SignInScreen.tsx` — superseded by `AuthScreen`.
- `mobile/src/screens/SignUpScreen.tsx` — superseded by `AuthScreen`.
- `mobile/src/screens/ProfileSetupScreen.tsx` — not referenced.
- `mobile/src/screens/ConfirmEmailScreen.tsx` — superseded by `VerifyCodeScreen` (consolidated verify/resend flow).

Edited files
- `mobile/src/graphql/messages.ts`
  - Removed unused `countMessagesAfter` helper.
  - Removed unused `createImageMessage` helper. Image sending uses `sendTextMessageCompat` with URL content.

Notes and rationale
- Navigation in `mobile/App.tsx` routes only through `AuthScreen` → `VerifyCodeScreen` → `Conversations`/`Chat`/`GroupCreate`. The deleted screens were not registered or referenced.
- Message screens/components already render timestamps and read receipts; cleanup does not alter message flow.
- Kept all VTL/root-schema compatibility paths and subscription fallbacks to preserve reliability.

Project hygiene (follow-up cleanup)
- Migrate `mobile/app.json` settings (icons, splash, adaptiveIcon, web favicon) into `mobile/app.config.ts` and delete `app.json`.
- Remove unused Amplify config artifacts: `mobile/src/aws-exports.js`, `mobile/src/amplifyconfiguration.json`, `mobile/amplify/`, `mobile/amplify-api-config.json`.
- Remove `react-native-dotenv` from `mobile/package.json` (no `@env` usage; `app.config.ts` uses `dotenv/config`).
- Use only `mobile/.env` for mobile builds; no root `.env` required.

Post-clean validation
- App boot flow still references `AuthScreen`, `VerifyCodeScreen`, `HomeScreen` (utility), `Conversations`, `GroupCreate`, `Chat`.
- No imports targeted the removed functions/files.


