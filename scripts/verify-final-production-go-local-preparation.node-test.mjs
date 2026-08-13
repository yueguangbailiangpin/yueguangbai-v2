import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyFinalProductionGoWorkflows } from './final-production-go-workflow-governance.mjs';

const ci=`name: CI
on:
  pull_request:
  push:
    branches:
      - main
permissions:
  contents: read
jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - name: inspect only
        run: npx wrangler deploy --dry-run
`;
const health=`name: Health
on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:
permissions:
  contents: read
  issues: write
jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - name: probe
        run: node scripts/production-health-monitor.mjs
`;
const workflows=()=>({'ci.yml':ci,'production-health-monitor.yml':health});

test('accepts the exact canonical read-only workflow pair and dry-run deploy inspection',()=>{
  assert.doesNotThrow(()=>verifyFinalProductionGoWorkflows(workflows()));
});

test('rejects an unknown workflow fixture',()=>{
  const fixture=workflows();fixture['release.yml']='name: release\non:\n  workflow_dispatch:\n';
  assert.throws(()=>verifyFinalProductionGoWorkflows(fixture),/workflow inventory/u);
});

test('rejects a deploy command that is not explicitly dry-run',()=>{
  const fixture=workflows();fixture['ci.yml']=ci.replace('npx wrangler deploy --dry-run','npx wrangler deploy');
  assert.throws(()=>verifyFinalProductionGoWorkflows(fixture),/deploy command/u);
});

test('rejects a dangerous trigger fixture',()=>{
  const fixture=workflows();fixture['ci.yml']=ci.replace('  pull_request:\n','  pull_request_target:\n');
  assert.throws(()=>verifyFinalProductionGoWorkflows(fixture),/triggers|forbidden trigger/u);
});

test('rejects a missing canonical workflow fixture',()=>{
  const fixture=workflows();delete fixture['production-health-monitor.yml'];
  assert.throws(()=>verifyFinalProductionGoWorkflows(fixture),/workflow inventory/u);
});
