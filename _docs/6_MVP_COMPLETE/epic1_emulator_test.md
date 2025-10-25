### Emulator Test Checklist â€” Epic 1

Before running:
- PowerShell: `$env:AWS_PROFILE='my-aws-profile'`
- Ensure `.env` is populated with valid IDs and endpoint.

Steps:
1) Launch app in Android emulator (Expo Go)
2) Sign up with email, receive verification, confirm in-app
3) Sign in with email/password
4) On successful sign-in, call `updateUserProfile` with username/avatar
5) Fetch profile and render `ChatHeader` with username + avatar
6) Verify tokens persist across reload

Expected results:
- Sign up â†’ confirmation â†’ sign in completes
- Profile update succeeds; header shows username and avatar
- No secrets committed to git; `.env` ignored
