import type { OperationalAlertSink } from '../scheduled-operations/signals';

export const OPERATIONAL_ALERT_CHALLENGE_TYPES=['DELIVERY','FAILURE','RECOVERY'] as const;
export type OperationalAlertChallengeType=typeof OPERATIONAL_ALERT_CHALLENGE_TYPES[number];
export type OperationalAlertObservedOutcome='DELIVERED'|'FAILURE_PATH_VERIFIED'|'RECOVERED';

export interface OperationalAlertVerificationChallenge {
  protocol_version:'moonwhite-operational-alert-verification-v1';
  challenge_id:string;
  challenge_type:OperationalAlertChallengeType;
  nonce:string;
  release_sha:string;
  binding_fingerprint:string;
  sink_identity:string;
  sink_deployment_version:string;
  issued_at:number;
  expires_at:number;
  simulation_mode:'SAFE_NO_PRODUCTION_DISRUPTION';
}

export interface OperationalAlertVerificationReceipt {
  protocol_version:'moonwhite-operational-alert-verification-v1';
  receipt_id:string;
  challenge_id:string;
  challenge_type:OperationalAlertChallengeType;
  nonce:string;
  release_sha:string;
  binding_fingerprint:string;
  sink_identity:string;
  sink_deployment_version:string;
  observed_outcome:OperationalAlertObservedOutcome;
  issued_at:number;
  expires_at:number;
}

export interface OperationalAlertServiceBinding extends OperationalAlertSink {
  verifyOperationalAlertChallenge(challenge:OperationalAlertVerificationChallenge):Promise<unknown>;
}

export function isOperationalAlertServiceBinding(value:unknown):value is OperationalAlertServiceBinding{
  if(!value||typeof value!=='object')return false;
  const candidate=value as Partial<OperationalAlertServiceBinding>;
  return typeof candidate.notify==='function'&&typeof candidate.verifyOperationalAlertChallenge==='function';
}

export function expectedOperationalAlertOutcome(type:OperationalAlertChallengeType):OperationalAlertObservedOutcome{
  if(type==='DELIVERY')return'DELIVERED';
  if(type==='FAILURE')return'FAILURE_PATH_VERIFIED';
  return'RECOVERED';
}
