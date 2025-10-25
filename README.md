# cohort3_challenge2_markii
this is my second attempt after all my learnings

## Assistant Feature Flags

- `ASSISTANT_OPENAI_ENABLED`: Enables OpenAI-generated assistant replies (backend Lambda).
- `ASSISTANT_RECIPE_ENABLED`: Enables recipe suggestions flow (backend Lambda + mobile UI).
- `ASSISTANT_DECISIONS_ENABLED`: Enables decision summarization extraction. When enabled, the Lambda will attach `metadata.decisions = [{ title, summary, participants[], decidedAtISO }]` and a fallback attachment sentinel `decisions:{"decisions":[...]}` to assistant messages. Mobile shows a "View decisions" CTA and modal in assistant chats.

### How to enable

- Backend (deploy): pass `-EnableDecisions` to `scripts/agent/deploy.ps1`.
- Backend (env): ensure `ASSISTANT_DECISIONS_ENABLED=true` in Lambda environment.
- Mobile: set `ASSISTANT_DECISIONS_ENABLED=true` in `mobile/.env` and rebuild.

## OpenAI configuration

You can configure the Lambda to access the OpenAI API in one of two ways:

1) Inline API key
- Provide `-OpenAIApiKey <key>` to `scripts/agent/deploy.ps1`.
- The script sets the Lambda env `OPENAI_API_KEY`. The Lambda uses this directly.

2) AWS Secrets Manager
- Provide `-OpenAISecretArn arn:aws:secretsmanager:<region>:<account-id>:secret:<name>`.
- The Lambda will resolve the region from the ARN when calling Secrets Manager and read `SecretString`.
- If the secret JSON contains `apiKey` or `OPENAI_API_KEY` or `key`, that value will be used; otherwise the whole `SecretString` is treated as the key.

If both are provided, `OPENAI_API_KEY` (inline) takes precedence.