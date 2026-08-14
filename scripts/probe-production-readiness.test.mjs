import { describe,expect,it,vi } from 'vitest';
import { probeProductionReadiness } from './probe-production-readiness.mjs';

const readyUrl='https://app.example.test/ready';
const checks={schema:'ok',scheduler:'ok',outbox_delivery:'not_required',acquisition_maintenance:'ok',operational_alerts:'ok',object_storage:'ok',recovery:'ok',staff_access:'ok',release:'ok'};

describe('explicit production readiness probe',()=>{
  it('requires the eight mandatory checks and governed Outbox deferral',async()=>{
    const result=await probeProductionReadiness({readyUrl,fetchImpl:vi.fn(async()=>Response.json({data:{status:'ready',checks}}))});
    expect(result).toMatchObject({status:'PASS',checks:[...Object.keys(checks).filter((key)=>key!=='outbox_delivery'),'outbox_delivery'],external_calls:1});
  });

  it.each([undefined,'failed','ok'])('rejects outbox_delivery=%s even when the envelope claims ready',async(outbox_delivery)=>{
    await expect(probeProductionReadiness({readyUrl,fetchImpl:vi.fn(async()=>Response.json({data:{status:'ready',checks:{...checks,outbox_delivery}}}))}))
      .rejects.toThrow('production_readiness_check_failed:outbox_delivery');
  });

  it('rejects a non-200 response even when its body claims ready',async()=>{
    await expect(probeProductionReadiness({readyUrl,fetchImpl:vi.fn(async()=>Response.json({data:{status:'ready',checks}},{status:503}))}))
      .rejects.toThrow('production_not_ready_http_503');
  });
});
