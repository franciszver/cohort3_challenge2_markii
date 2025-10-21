### AppSync resolver setup (UserProfiles)

- Table: `UserProfiles` (see `docs/infra/user_profiles_table.yaml`)
- Authorization: Cognito User Pools

Before actions in PowerShell:

```powershell
$env:AWS_PROFILE='ciscodg@gmail'
```

Attach resolvers:
- `Query.getUserProfile` â†’ DynamoDB GetItem
  - Request: `docs/appsync/resolvers/Query.getUserProfile.request.vtl`
  - Response: `docs/appsync/resolvers/Query.getUserProfile.response.vtl`
- `Mutation.updateUserProfile` â†’ DynamoDB UpdateItem (uses `identity.sub` as userId)
  - Request: `docs/appsync/resolvers/Mutation.updateUserProfile.request.vtl`
  - Response: `docs/appsync/resolvers/Mutation.updateUserProfile.response.vtl`

Notes:
- `updateUserProfile` sets `createdAt` if not exists, updates `updatedAt`.
- Consider enforcing unique usernames via a separate table or write-time check.
