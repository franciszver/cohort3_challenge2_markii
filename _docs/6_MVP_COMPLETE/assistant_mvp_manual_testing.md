### Assistant MVP Manual Testing

#### Pre-reqs
- Mobile `.env` configured:
  - `AWS_REGION=us-east-1`
  - `APPSYNC_ENDPOINT=https://<appsync-api-id>.appsync-api.us-east-1.amazonaws.com/graphql`
  - Cognito IDs as provided
  - `ASSISTANT_ENABLED=true`
  - `ASSISTANT_ENDPOINT=https://<your-api-id>.execute-api.us-east-1.amazonaws.com/prod`
- Lambda deployed with IAM role allowing `appsync:GraphQL` to the API.

#### Steps
1) Launch the app and sign in.
2) In Conversations, verify the “Assistant” row is visible.
3) Tap “Assistant” → navigates to `assistant::<yourUserId>`.
4) Send “Hello world”.
5) Observe "Assistant is thinking…" appears briefly.
6) Within ~1–2s, an assistant message appears: `Assistant Echo: I saw ‘Hello world’. I’ll be smarter soon.`
7) Send another message; verify a new echo appears.
8) Set `ASSISTANT_ENABLED=false` and rebuild; the row disappears and normal chats are unaffected.

#### Expected
- Assistant replies arrive in the same conversation and are attributed to `assistant-bot`.
- No crashes; if the agent is offline, only the echo is missing and the user’s own message still sends.

#### Notes
- This MVP uses a private, unauthenticated URL. Do not share the endpoint publicly.


