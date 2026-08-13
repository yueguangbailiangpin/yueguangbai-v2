import { hashCanonicalJson,operationalAlertDescriptorFromRuntime,parseExactGitCommitSha,type OperationalAlertBindingDescriptor } from '@ygb/domain';
import type { AppBindings } from '../app';
import { isOperationalAlertServiceBinding,type OperationalAlertServiceBinding } from './alert-sink-contract';

export interface OperationalAlertRuntimeConfiguration {
  releaseSha:string;
  descriptor:OperationalAlertBindingDescriptor;
  fingerprint:string;
  sink:OperationalAlertServiceBinding;
}

export async function resolveOperationalAlertRuntimeConfiguration(bindings:Pick<AppBindings,
  'APP_ENVIRONMENT'|'APP_RELEASE_SHA'|'OPERATIONAL_ALERT_MODE'|'OPERATIONAL_ALERT_SINK'|
  'OPERATIONAL_ALERT_SINK_SERVICE'|'OPERATIONAL_ALERT_SINK_ENTRYPOINT'|'OPERATIONAL_ALERT_SINK_IDENTITY'|
  'OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION'|'OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT'
>):Promise<OperationalAlertRuntimeConfiguration|null>{
  if(bindings.APP_ENVIRONMENT!=='production'||bindings.OPERATIONAL_ALERT_MODE!=='bound'||!isOperationalAlertServiceBinding(bindings.OPERATIONAL_ALERT_SINK))return null;
  const releaseSha=parseExactGitCommitSha(bindings.APP_RELEASE_SHA);
  const descriptor=operationalAlertDescriptorFromRuntime({
    serviceTarget:bindings.OPERATIONAL_ALERT_SINK_SERVICE,
    entrypoint:bindings.OPERATIONAL_ALERT_SINK_ENTRYPOINT,
    sinkIdentity:bindings.OPERATIONAL_ALERT_SINK_IDENTITY,
    sinkDeploymentVersion:bindings.OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION,
  });
  if(!releaseSha||!descriptor)return null;
  const fingerprint=await hashCanonicalJson(descriptor);
  if(bindings.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT!==fingerprint)return null;
  return Object.freeze({releaseSha,descriptor,fingerprint,sink:bindings.OPERATIONAL_ALERT_SINK});
}
