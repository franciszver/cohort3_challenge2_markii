Param(
  [Parameter(Mandatory=$true)][string]$Profile,
  [Parameter(Mandatory=$true)][string]$Region,
  [Parameter(Mandatory=$true)][string]$AppSyncApiId,
  [Parameter(Mandatory=$true)][string]$AppSyncEndpoint,
  [Parameter(Mandatory=$false)][string]$OpenAISecretArn,
  [Parameter(Mandatory=$false)][string]$OpenAIApiKey,
  [Parameter(Mandatory=$false)][switch]$EnableOpenAI,
  [Parameter(Mandatory=$false)][switch]$EnableRecipes,
  [Parameter(Mandatory=$false)][switch]$EnableDecisions,
  [Parameter(Mandatory=$false)][switch]$EnableConflicts,
  [Parameter(Mandatory=$false)][switch]$EnableCalendarConflicts,
  [Parameter(Mandatory=$false)][string]$ApiId,
  [Parameter(Mandatory=$false)][string]$OpenAIModel = 'gpt-4o-mini',
  [Parameter(Mandatory=$false)][switch]$DebugLogs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Exec($cmd) {
  Write-Host "> $cmd" -ForegroundColor Cyan
  $out = Invoke-Expression $cmd
  return $out
}

# Ensure AWS env
$env:AWS_PROFILE = $Profile
$env:AWS_DEFAULT_REGION = $Region

# Resolve account id
$acct = (aws sts get-caller-identity --output json | ConvertFrom-Json).Account
if (-not $acct) { throw 'Unable to resolve AWS account id. Check your profile/credentials.' }

# Prepare dist
New-Item -ItemType Directory -Force -Path dist | Out-Null
Copy-Item -Force scripts/agent/assistant.js dist/assistant.js
Compress-Archive -Force -Path dist/assistant.js -DestinationPath dist/assistant.zip

# Compute env vars JSON file for Lambda (PowerShell-safe)
$flagOpenAI = if ($EnableOpenAI) { 'true' } else { 'false' }
$flagRecipes = if ($EnableRecipes) { 'true' } else { 'false' }
$flagDecisions = if ($EnableDecisions) { 'true' } else { 'false' }
$flagConflicts = if ($EnableConflicts) { 'true' } else { 'false' }
$flagCalendarConflicts = if ($EnableCalendarConflicts) { 'true' } else { 'false' }
$envVarsHash = @{
  APPSYNC_ENDPOINT = $AppSyncEndpoint
  ASSISTANT_BOT_USER_ID = 'assistant-bot'
  ASSISTANT_REPLY_PREFIX = 'Assistant Echo:'
  ASSISTANT_OPENAI_ENABLED = $flagOpenAI
  ASSISTANT_RECIPE_ENABLED = $flagRecipes
  ASSISTANT_DECISIONS_ENABLED = $flagDecisions
  ASSISTANT_CONFLICTS_ENABLED = $flagConflicts
  ASSISTANT_CALENDAR_CONFLICTS_ENABLED = $flagCalendarConflicts
  OPENAI_MODEL = $OpenAIModel
}
if ($DebugLogs) { $envVarsHash['DEBUG_LOGS'] = 'true' }
if ($OpenAISecretArn) { $envVarsHash['OPENAI_SECRET_ARN'] = $OpenAISecretArn }
if ($OpenAIApiKey) { $envVarsHash['OPENAI_API_KEY'] = $OpenAIApiKey }
$envObj = @{ Variables = $envVarsHash }
$envFile = Join-Path $env:TEMP 'assistant-env.json'
$envObj | ConvertTo-Json -Depth 5 | Set-Content -Path $envFile -Encoding ascii

# IAM role
$roleName = 'AssistantMvpLambdaRole'
$trust = @'
{
  "Version":"2012-10-17",
  "Statement":[{ "Effect":"Allow", "Principal":{ "Service":"lambda.amazonaws.com" }, "Action":"sts:AssumeRole" }]
}
'@
$policy = @"
{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Action":["appsync:GraphQL"],
    "Resource":["arn:aws:appsync:${Region}:${acct}:apis/${AppSyncApiId}/*"]
  }]
}
"@

try { aws iam create-role --role-name $roleName --assume-role-policy-document $trust | Out-Null } catch {}
aws iam attach-role-policy --role-name $roleName --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole | Out-Null
$policyFile = Join-Path $env:TEMP 'assistant-appsync-policy.json'
$policy | Set-Content -Path $policyFile -Encoding ascii
aws iam put-role-policy --role-name $roleName --policy-name AssistantMvpAppSyncPolicy --policy-document file://$policyFile | Out-Null

# Optional: grant Secrets Manager read for OpenAI key
if ($OpenAISecretArn) {
  $secp = @"
{
  "Version":"2012-10-17",
  "Statement":[{ "Effect":"Allow", "Action":["secretsmanager:GetSecretValue"], "Resource":["$OpenAISecretArn"] }]
}
"@
  $secpFile = Join-Path $env:TEMP 'assistant-secrets-policy.json'
  $secp | Set-Content -Path $secpFile -Encoding ascii
  aws iam put-role-policy --role-name $roleName --policy-name AssistantMvpSecretsRead --policy-document file://$secpFile | Out-Null
}

Start-Sleep -Seconds 8

# Lambda
$fnName = 'assistant-mvp'
$roleArn = "arn:aws:iam::${acct}:role/${roleName}"
try {
  aws lambda create-function `
    --function-name $fnName `
    --runtime nodejs20.x `
    --handler assistant.handler `
    --role $roleArn `
    --zip-file fileb://dist/assistant.zip `
    --timeout 10 `
    --memory-size 256 `
    --environment file://$envFile | Out-Null
} catch {
  aws lambda update-function-code --function-name $fnName --zip-file fileb://dist/assistant.zip | Out-Null
  aws lambda update-function-configuration --function-name $fnName --timeout 10 --memory-size 256 --environment file://$envFile | Out-Null
}

# HTTP API (find-or-create; prefer provided ApiId to keep endpoint stable)
$apiName = 'assistant-mvp'
if (-not $ApiId) {
  $existingId = (aws apigatewayv2 get-apis --query "Items[?Name=='$apiName'].ApiId | [0]" --output text 2>$null)
  if ($existingId -and $existingId -ne 'None') { $ApiId = $existingId }
}
if (-not $ApiId) {
  $ApiId = (aws apigatewayv2 create-api --name $apiName --protocol-type HTTP --target "arn:aws:lambda:${Region}:${acct}:function:${fnName}" --query ApiId --output text)
}
if (-not $ApiId) { throw 'Failed to create or locate HTTP API.' }

# Create/ensure Lambda integration for specific route (upsert)
$fnArn = "arn:aws:lambda:${Region}:${acct}:function:${fnName}"
$intId = (aws apigatewayv2 create-integration --api-id $ApiId --integration-type AWS_PROXY --integration-uri $fnArn --payload-format-version 2.0 --query IntegrationId --output text 2>$null)
if (-not $intId -or $intId -eq 'None') {
  $intId = (aws apigatewayv2 get-integrations --api-id $ApiId --query 'Items[0].IntegrationId' --output text 2>$null)
}
$routeId = (aws apigatewayv2 get-routes --api-id $ApiId --query "Items[?RouteKey=='POST /agent/weekend-plan'].RouteId | [0]" --output text 2>$null)
if ($routeId -and $routeId -ne 'None') {
  aws apigatewayv2 update-route --api-id $ApiId --route-id $routeId --target "integrations/$intId" | Out-Null
} else {
  try { aws apigatewayv2 create-route --api-id $ApiId --route-key 'POST /agent/weekend-plan' --target "integrations/$intId" | Out-Null } catch {}
}

# Deploy stage (idempotent)
$depId = (aws apigatewayv2 create-deployment --api-id $ApiId --query DeploymentId --output text)
try { aws apigatewayv2 create-stage --api-id $ApiId --stage-name prod --deployment-id $depId | Out-Null } catch {}

# Lambda permission for API Gateway invocation (unique statement id to avoid conflicts)
$srcArn = "arn:aws:execute-api:${Region}:${acct}:${ApiId}/*/POST/agent/weekend-plan"
$statementId = "AllowInvokeFromHttpApi_" + ([Guid]::NewGuid().ToString('N'))
try { aws lambda add-permission --function-name $fnName --statement-id $statementId --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn $srcArn | Out-Null } catch {}

$baseUrl = "https://${ApiId}.execute-api.${Region}.amazonaws.com/prod"
Write-Host "Assistant endpoint: $baseUrl" -ForegroundColor Green


