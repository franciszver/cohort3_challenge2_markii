### Deploy infrastructure (DynamoDB UserProfiles table)

- Ensure profile is set in PowerShell before running commands:

```powershell
$env:AWS_PROFILE='my-aws-profile'
```

- Deploy (region `us-east-1`):

```powershell
aws cloudformation deploy `
  --stack-name user-profiles-table `
  --template-file docs/infra/user_profiles_table.yaml `
  --region us-east-1
```

- Check stack status:

```powershell
aws cloudformation describe-stacks --stack-name user-profiles-table --region us-east-1
```

- Delete stack (cleanup):

```powershell
aws cloudformation delete-stack --stack-name user-profiles-table --region us-east-1
```
