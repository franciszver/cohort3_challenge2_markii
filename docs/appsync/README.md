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

#### lookupByEmail resolver (override-based)

- Extend schema: `extend type Query { lookupByEmail(email: String!): ID @aws_cognito_user_pools }`
- Datasource: DynamoDB `UserProfiles`
- Resolver VTLs:
  - Request: `docs/appsync/resolvers/Query.lookupByEmail.request.vtl` (GSI `emailLowerGSI` on `emailLower`)
  - Response: `docs/appsync/resolvers/Query.lookupByEmail.response.vtl` (returns `userId` or `null`)
- Test query:
  ```graphql
  query($email:String!){ lookupByEmail(email:$email) }
  ```
