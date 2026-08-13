export const OPERATIONAL_ALERT_BINDING_NAME='OPERATIONAL_ALERT_SINK';
export const DEFAULT_OPERATIONAL_ALERT_ENTRYPOINT='default';

export interface OperationalAlertBindingProps {
  service_target:string;
  entrypoint:string|null;
  sink_identity:string;
  sink_deployment_version:string;
}

export interface OperationalAlertBindingDescriptor {
  binding:typeof OPERATIONAL_ALERT_BINDING_NAME;
  service_target:string;
  entrypoint:string|null;
  props:OperationalAlertBindingProps;
}

export function parseExactGitCommitSha(value:unknown):string|null{
  return typeof value==='string'&&/^[0-9a-f]{40}$/iu.test(value)?value.toLowerCase():null;
}

export function operationalAlertDescriptorFromService(value:unknown):OperationalAlertBindingDescriptor|null{
  const service=record(value);
  if(!service||!allowedKeys(service,['binding','service','props'],['entrypoint']))return null;
  if(service['binding']!==OPERATIONAL_ALERT_BINDING_NAME)return null;
  const target=resourceName(service['service']);
  const entrypoint=canonicalEntrypoint(service['entrypoint']);
  const props=record(service['props']);
  if(!target||entrypoint===undefined||!props||!exactKeys(props,['service_target','entrypoint','sink_identity','sink_deployment_version']))return null;
  const propTarget=resourceName(props['service_target']);
  const propEntrypoint=canonicalEntrypoint(props['entrypoint']);
  const identity=safeIdentifier(props['sink_identity'],8,200);
  const version=safeIdentifier(props['sink_deployment_version'],7,200);
  if(!propTarget||propEntrypoint===undefined||!identity||!version||propTarget!==target||propEntrypoint!==entrypoint)return null;
  return{binding:OPERATIONAL_ALERT_BINDING_NAME,service_target:target,entrypoint,props:{service_target:propTarget,entrypoint:propEntrypoint,sink_identity:identity,sink_deployment_version:version}};
}

export function operationalAlertDescriptorFromRuntime(value:{serviceTarget:unknown;entrypoint:unknown;sinkIdentity:unknown;sinkDeploymentVersion:unknown}):OperationalAlertBindingDescriptor|null{
  const target=resourceName(value.serviceTarget),entrypoint=canonicalRuntimeEntrypoint(value.entrypoint);
  const identity=safeIdentifier(value.sinkIdentity,8,200),version=safeIdentifier(value.sinkDeploymentVersion,7,200);
  if(!target||entrypoint===undefined||!identity||!version)return null;
  return{binding:OPERATIONAL_ALERT_BINDING_NAME,service_target:target,entrypoint,props:{service_target:target,entrypoint,sink_identity:identity,sink_deployment_version:version}};
}

export function runtimeEntrypointValue(value:string|null):string{return value??DEFAULT_OPERATIONAL_ALERT_ENTRYPOINT;}

function canonicalRuntimeEntrypoint(value:unknown):string|null|undefined{
  if(value===DEFAULT_OPERATIONAL_ALERT_ENTRYPOINT)return null;
  return canonicalEntrypoint(value);
}
function canonicalEntrypoint(value:unknown):string|null|undefined{
  if(value===null)return null;
  return safeIdentifier(value,1,128);
}
function resourceName(value:unknown):string|null{return typeof value==='string'&&value.length>=3&&value.length<=128&&/^[a-z0-9][a-z0-9_-]*$/u.test(value)?value:null;}
function safeIdentifier(value:unknown,min:number,max:number):string|null{return typeof value==='string'&&value.length>=min&&value.length<=max&&!/REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu.test(value)&&/^[A-Za-z0-9._:/@-]+$/u.test(value)?value:null;}
function record(value:unknown):Record<string,unknown>|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}
function exactKeys(value:Record<string,unknown>,expected:readonly string[]):boolean{const actual=Object.keys(value).sort(),keys=[...expected].sort();return actual.length===keys.length&&actual.every((key,index)=>key===keys[index]);}
function allowedKeys(value:Record<string,unknown>,required:readonly string[],optional:readonly string[]):boolean{return required.every((key)=>Object.hasOwn(value,key))&&Object.keys(value).every((key)=>required.includes(key)||optional.includes(key));}
