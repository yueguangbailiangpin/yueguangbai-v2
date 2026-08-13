import { describe,expect,it } from 'vitest';
import { canonicalJson } from './serialization/canonical-json';
import { operationalAlertDescriptorFromRuntime,operationalAlertDescriptorFromService,parseExactGitCommitSha,runtimeEntrypointValue } from './operational-alert-binding';

describe('operational alert binding descriptor',()=>{
  it('normalizes the exact rendered service descriptor and canonical default entrypoint',()=>{
    const service={binding:'OPERATIONAL_ALERT_SINK',service:'alerts-primary',entrypoint:null,props:{sink_deployment_version:'deploy-001',entrypoint:null,sink_identity:'service:alerts-primary',service_target:'alerts-primary'}};
    const descriptor=operationalAlertDescriptorFromService(service);
    expect(descriptor).not.toBeNull();
    expect(canonicalJson(descriptor)).toBe('{"binding":"OPERATIONAL_ALERT_SINK","entrypoint":null,"props":{"entrypoint":null,"service_target":"alerts-primary","sink_deployment_version":"deploy-001","sink_identity":"service:alerts-primary"},"service_target":"alerts-primary"}');
    expect(operationalAlertDescriptorFromRuntime({serviceTarget:'alerts-primary',entrypoint:'default',sinkIdentity:'service:alerts-primary',sinkDeploymentVersion:'deploy-001'})).toEqual(descriptor);
    expect(runtimeEntrypointValue(null)).toBe('default');
    expect(operationalAlertDescriptorFromService({binding:'OPERATIONAL_ALERT_SINK',service:'alerts-primary',props:{sink_deployment_version:'deploy-001',entrypoint:null,sink_identity:'service:alerts-primary',service_target:'alerts-primary'}})).toEqual(descriptor);
  });

  it('rejects extra props, mismatched mirrors, placeholders and non-exact release SHAs',()=>{
    const base={binding:'OPERATIONAL_ALERT_SINK',service:'alerts-primary',entrypoint:'AlertSinkEntrypoint',props:{service_target:'alerts-primary',entrypoint:'AlertSinkEntrypoint',sink_identity:'service:alerts-primary',sink_deployment_version:'deploy-001'}};
    expect(operationalAlertDescriptorFromService({...base,props:{...base.props,extra:true}})).toBeNull();
    expect(operationalAlertDescriptorFromService({...base,props:{...base.props,service_target:'alerts-other'}})).toBeNull();
    expect(operationalAlertDescriptorFromRuntime({serviceTarget:'REQUIRED_SERVICE',entrypoint:'default',sinkIdentity:'service:alerts-primary',sinkDeploymentVersion:'deploy-001'})).toBeNull();
    expect(parseExactGitCommitSha('a'.repeat(40))).toBe('a'.repeat(40));
    for(const value of [undefined,'abc1234','g'.repeat(40),'a'.repeat(39),'a'.repeat(41),` ${'a'.repeat(40)} `,'REQUIRED_RELEASE_COMMIT_SHA'])expect(parseExactGitCommitSha(value)).toBeNull();
  });
});
