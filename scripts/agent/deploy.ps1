Param(
  [Parameter(Mandatory=$true)][string]$Profile,
  [Parameter(Mandatory=$true)][string]$Region,
  [Parameter(Mandatory=$true)][string]$AppSyncApiId,
  [Parameter(Mandatory=$true)][string]$AppSyncEndpoint
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

# IAM role
$roleName = 'AssistantMvpLambdaRole'
$trust = @'{
  "Version":"2012-10-17",
  "Statement":[{ "Effect":"Allow", "Principal":{ "Service":"lambda.amazonaws.com" }, "Action":"sts:AssumeRole" }]
}'@
$policy = @"{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Action":["appsync:GraphQL"],
    "Resource":["arn:aws:appsync:$Region:$acct:apis/$AppSyncApiId/*"]
  }]
}"@

try { aws iam create-role --role-name $roleName --assume-role-policy-document $trust | Out-Null } catch {}
aws iam attach-role-policy --role-name $roleName --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole | Out-Null
aws iam put-role-policy --role-name $roleName --policy-name AssistantMvpAppSyncPolicy --policy-document $policy | Out-Null

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
    --environment Variables=@{APPSYNC_ENDPOINT="$AppSyncEndpoint";AWS_REGION="$Region";ASSISTANT_BOT_USER_ID="assistant-bot";ASSISTANT_REPLY_PREFIX="Assistant Echo:"} | Out-Null
} catch {
  aws lambda update-function-code --function-name $fnName --zip-file fileb://dist/assistant.zip | Out-Null
  aws lambda update-function-configuration --function-name $fnName --environment Variables=@{APPSYNC_ENDPOINT="$AppSyncEndpoint";AWS_REGION="$Region";ASSISTANT_BOT_USER_ID="assistant-bot";ASSISTANT_REPLY_PREFIX="Assistant Echo:"} | Out-Null
}

# HTTP API
$apiName = 'assistant-mvp'
$apiId = (aws apigatewayv2 create-api --name $apiName --protocol-type HTTP --target "arn:aws:lambda:${Region}:${acct}:function:${fnName}" --output json | ConvertFrom-Json).ApiId
if (-not $apiId) {
  $existing = (aws apigatewayv2 get-apis --output json | ConvertFrom-Json).Items | Where-Object { $_.Name -eq $apiName }
  if ($existing) { $apiId = $existing.ApiId }
}
if (-not $apiId) { throw 'Failed to create or locate HTTP API.' }

# Create Lambda integration for specific route
$fnArn = "arn:aws:lambda:${Region}:${acct}:function:${fnName}"
$intId = (aws apigatewayv2 create-integration --api-id $apiId --integration-type AWS_PROXY --integration-uri $fnArn --payload-format-version 2.0 --output json | ConvertFrom-Json).IntegrationId
try { aws apigatewayv2 create-route --api-id $apiId --route-key 'POST /agent/weekend-plan' --target "integrations/$intId" | Out-Null } catch {}

# Deploy stage
$depId = (aws apigatewayv2 create-deployment --api-id $apiId --output json | ConvertFrom-Json).DeploymentId
try { aws apigatewayv2 create-stage --api-id $apiId --stage-name prod --deployment-id $depId | Out-Null } catch {}

# Lambda permission for API Gateway invocation
$srcArn = "arn:aws:execute-api:${Region}:${acct}:${apiId}/*/POST/agent/weekend-plan"
try { aws lambda add-permission --function-name $fnName --statement-id AllowInvokeFromHttpApi --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn $srcArn | Out-Null } catch {}

$baseUrl = "https://${apiId}.execute-api.${Region}.amazonaws.com/prod"
Write-Host "Assistant endpoint: $baseUrl" -ForegroundColor Green


