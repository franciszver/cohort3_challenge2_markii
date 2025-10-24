'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function getApiId() {
  const fromEnv = process.env.APPSYNC_API_ID;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const arg = process.argv.find(a => a.startsWith('--api-id='));
  if (arg) return arg.split('=')[1];
  return null;
}

function main() {
  const apiId = getApiId();
  if (!apiId) {
    console.error('Error: missing AppSync API id. Set APPSYNC_API_ID env or pass --api-id=XXXX');
    process.exit(1);
  }

  const schemaPath = path.resolve(__dirname, '..', 'schema.graphql');
  if (!fs.existsSync(schemaPath)) {
    console.error(`Error: schema not found at ${schemaPath}`);
    process.exit(1);
  }

  const schemaUri = 'fileb://' + schemaPath.replace(/\\/g, '/');

  try {
    console.log(`[push-schema] Starting schema creation for API ${apiId} using ${schemaUri} ...`);
    execSync(`aws appsync start-schema-creation --api-id ${apiId} --definition ${schemaUri}`, { stdio: 'inherit' });
  } catch (err) {
    console.error('[push-schema] Failed to start schema creation');
    process.exit(1);
  }

  try {
    console.log(`[push-schema] Fetching schema creation status for API ${apiId} ...`);
    execSync(`aws appsync get-schema-creation-status --api-id ${apiId}`, { stdio: 'inherit' });
  } catch (err) {
    console.error('[push-schema] Failed to get schema creation status');
    process.exit(1);
  }
}

main();


