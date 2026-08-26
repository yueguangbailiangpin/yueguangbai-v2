import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  executeStagingFirstOwnerBootstrap,
  inspectStagingFirstOwnerBootstrap,
  parseBootstrapArguments,
  readExternalBootstrapInput,
} from './bootstrap-staging-first-owner.mjs';

describe('staging first owner operator entrypoint', () => {
  it('is read-only by default and requires an exact destructive confirmation', () => {
    expect(inspectStagingFirstOwnerBootstrap()).toMatchObject({
      status: 'BLOCKED_NEEDS_OPERATOR_INPUT',
      remote_writes: 0,
      environment: 'staging',
    });
    expect(() => parseBootstrapArguments(['--execute', 'yes']))
      .toThrow('invalid_staging_first_owner_arguments');
    expect(() => parseBootstrapArguments([
      '--execute', 'STAGING_FIRST_OWNER',
      '--account-id', 'a'.repeat(32),
      '--database-id', '11111111-1111-4111-8111-111111111111',
      '--database-name', 'yueguangbai-v2-production',
      '--input', '/tmp/staging-owner.json',
    ])).toThrow('invalid_staging_first_owner_arguments');
  });

  it('accepts only an external owner-only input file and keeps values out of reports', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ygb-staging-owner-'));
    try {
      const file = path.join(directory, 'owner.json');
      writeFileSync(file, JSON.stringify({
        display_name: 'Staging Owner',
        email: 'owner@example.test',
        idempotency_key: 'staging:first-owner:v1',
      }), { mode: 0o600 });
      expect(readExternalBootstrapInput(file)).toEqual({
        displayName: 'Staging Owner',
        email: 'owner@example.test',
        idempotencyKey: 'staging:first-owner:v1',
      });
      chmodSync(file, 0o644);
      expect(() => readExternalBootstrapInput(file))
        .toThrow('input_file_permissions_unsafe');
      expect(JSON.stringify(inspectStagingFirstOwnerBootstrap()))
        .not.toContain('owner@example.test');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('verifies the exact remote D1 identity before invoking the parameterized bootstrap',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'ygb-staging-execute-'));
    try{
      const inputFile=path.join(directory,'owner.json');
      writeFileSync(inputFile,JSON.stringify({display_name:'Staging Owner',email:'owner@example.test',idempotency_key:'staging:first-owner:v1'}),{mode:0o600});
      const bootstrap=vi.fn(async()=>({staff_id:'staging-owner-safe-id',role_code:'owner',status:'ACTIVE'}));
      const fetchImpl=vi.fn(async()=>Response.json({success:true,result:{uuid:'11111111-1111-4111-8111-111111111111',name:'yueguangbai-v2-staging'}}));
      await expect(executeStagingFirstOwnerBootstrap({
        accountId:'a'.repeat(32),databaseId:'11111111-1111-4111-8111-111111111111',
        databaseName:'yueguangbai-v2-staging',inputFile,
      },{token:'operator-token-value-that-is-never-logged',fetchImpl,bootstrap})).resolves.toEqual({
        status:'STAGING_FIRST_OWNER_BOOTSTRAPPED',staff_id:'staging-owner-safe-id',
        role_code:'owner',remote_writes:1,production_touched:false,
      });
      expect(bootstrap).toHaveBeenCalledOnce();
      expect(JSON.stringify(bootstrap.mock.calls[0])).toContain('owner@example.test');
      expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('owner@example.test');
    }finally{rmSync(directory,{recursive:true,force:true});}
  });

  it('drives the real bootstrap through string-only REST parameters',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'ygb-staging-wire-'));
    try{
      const inputFile=path.join(directory,'owner.json');
      writeFileSync(inputFile,JSON.stringify({display_name:'Staging Owner',email:'owner@example.test',idempotency_key:'staging:first-owner:wire-v1'}),{mode:0o600});
      const batches=[];
      const fetchImpl=vi.fn(async(_url,init={})=>{
        if(!init.method)return Response.json({success:true,result:{uuid:'11111111-1111-4111-8111-111111111111',name:'yueguangbai-v2-staging'}});
        const body=JSON.parse(String(init.body));
        const queries=Array.isArray(body.batch)?body.batch:[body];
        expect(queries.every((query)=>Array.isArray(query.params)
          &&query.params.every((value)=>typeof value==='string'))).toBe(true);
        if(Array.isArray(body.batch))batches.push(body.batch);
        const result=queries.map((query)=>({
          success:true,
          results:String(query.sql).includes('SELECT schema_version FROM app_schema_state')
            ?[{schema_version: 25}]
            :[],
          meta:{changes:String(query.sql).includes('INSERT OR IGNORE INTO command_idempotency_records')?1:0},
        }));
        return Response.json({success:true,result});
      });
      await expect(executeStagingFirstOwnerBootstrap({
        accountId:'a'.repeat(32),databaseId:'11111111-1111-4111-8111-111111111111',
        databaseName:'yueguangbai-v2-staging',inputFile,
      },{token:'operator-token-value-that-is-never-logged',fetchImpl})).resolves.toMatchObject({
        status:'STAGING_FIRST_OWNER_BOOTSTRAPPED',role_code:'owner',remote_writes:1,
      });
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(11);
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});
