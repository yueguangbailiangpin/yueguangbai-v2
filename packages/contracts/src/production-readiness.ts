export const PRODUCTION_READINESS_FORMAT_VERSION = 1 as const;

export type StorageLocation = 'R2' | 'DRIVE';
export type ReleaseGateStatus =
  | 'LOCAL_PASS'
  | 'OWNER_ACTION_REQUIRED'
  | 'PRODUCTION_GO_BLOCKED';

export interface DatabaseInventoryEntry {
  name: string;
  table_name: string;
  definition_sha256: string;
}

export interface D1BackupManifest {
  format_version: typeof PRODUCTION_READINESS_FORMAT_VERSION;
  generated_at_utc_ms: number;
  release_commit_sha: string;
  time_basis: 'UTC_MS';
  display_timezone: 'Asia/Shanghai';
  source: {
    kind: 'LOCAL_OR_ISOLATED_D1_EXPORT';
    anonymous_fixture: boolean;
  };
  schema_version: number;
  schema_fingerprint_sha256: string;
  inventory: {
    tables: DatabaseInventoryEntry[];
    views: DatabaseInventoryEntry[];
    triggers: DatabaseInventoryEntry[];
    indexes: DatabaseInventoryEntry[];
  };
  row_counts: Record<string, number>;
  financial_aggregates: Record<string, Record<string, string | number>>;
  integrity: {
    integrity_check: 'ok';
    foreign_key_violations: number;
  };
  smoke_reads: Record<string, number>;
  tools: {
    node: string;
    npm: string;
    sqlite: string;
    wrangler: string;
  };
  backup: {
    compression: 'gzip';
    uncompressed_bytes: number;
    uncompressed_sha256: string;
    compressed_bytes: number;
    compressed_sha256: string;
  };
}

export interface D1BackupAttestation {
  format_version: typeof PRODUCTION_READINESS_FORMAT_VERSION;
  generated_at_utc_ms: number;
  release_commit_sha: string;
  schema_version: number;
  cipher: 'AES-256-GCM';
  kdf: 'HKDF-SHA256';
  key_id: string;
  encrypted_bundle_bytes: number;
  encrypted_bundle_sha256: string;
  manifest_sha256: string;
  anonymous_fixture: boolean;
  attestation_hmac_sha256: string;
}

export interface D1RestoreReport {
  format_version: typeof PRODUCTION_READINESS_FORMAT_VERSION;
  verified_at_utc_ms: number;
  release_commit_sha: string;
  status: 'PASS' | 'FAIL';
  schema_version: number;
  schema_match: boolean;
  inventory_match: boolean;
  row_counts_match: boolean;
  financial_aggregates_match: boolean;
  integrity_check: 'ok' | 'failed';
  foreign_key_violations: number;
  smoke_reads_match: boolean;
  mismatches: string[];
}

export interface OfflineStorageManifestEntry {
  authority_hash: string;
  protected_ref: string;
  byte_size: number;
  mime_type: string;
  sha256: string;
  public_url: string | null;
}

export interface FileAuthorityEvidence {
  authority_hash: string;
  expected_location: StorageLocation;
  expected_protected_ref: string;
  byte_size: number;
  mime_type: string;
  sha256: string;
}

export type FileReconciliationFindingKind =
  | 'MISSING'
  | 'ORPHAN'
  | 'DUPLICATE'
  | 'PROTECTED_REF_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'MIME_MISMATCH'
  | 'SHA256_MISMATCH'
  | 'PUBLIC_LINK';

export interface FileReconciliationFinding {
  kind: FileReconciliationFindingKind;
  location: StorageLocation;
  authority_hash: string;
}

export interface FileReconciliationReport {
  format_version: typeof PRODUCTION_READINESS_FORMAT_VERSION;
  generated_at_utc_ms: number;
  status: 'PASS' | 'FAIL';
  authority_count: number;
  r2_manifest_count: number;
  drive_manifest_count: number;
  finding_counts: Record<FileReconciliationFindingKind, number>;
  findings: FileReconciliationFinding[];
  external_calls: 0;
  r2_deletes: 0;
}

export interface CapacityDryRunReport {
  format_version: typeof PRODUCTION_READINESS_FORMAT_VERSION;
  generated_at_utc_ms: number;
  status: 'PASS' | 'FAIL';
  staff_count: number;
  daily_orders: number;
  peak_orders_15m: number;
  file_objects: number;
  actionable_summaries: number;
  order_batches_at_50: number;
  file_batches_at_50: number;
  max_orders_per_staff: number;
  reconciliation_findings: number;
  elapsed_ms: number;
  external_calls: 0;
}

export interface ProductionAlertControl {
  signal: string;
  threshold: string;
  diagnostic: string;
  kill_switch: string;
  recovery: string;
  escalation: 'PROVIDER_INDEPENDENT_REQUIRED';
}

export const PRODUCTION_ALERT_CONTROLS: readonly ProductionAlertControl[] = [
  { signal: 'worker_5xx', threshold: '5m>=3', diagnostic: 'request-id/status aggregate', kill_switch: 'deployment rollback', recovery: 'compatible Worker switch or forward fix', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
  { signal: 'login_anomaly', threshold: '10m>=5', diagnostic: 'opaque security-event aggregate', kill_switch: 'affected auth/provider disable', recovery: 'session revoke and provider verification', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
  { signal: 'job_stale_or_backlog', threshold: 'stale>=6h or 3 breaches/30m', diagnostic: 'job health/lease/backlog', kill_switch: 'global or per-job disable', recovery: 'lease takeover and bounded replay', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
  { signal: 'file_integrity', threshold: '30m>=3 or any checksum mismatch', diagnostic: 'D1 authority plus protected manifest refs', kill_switch: 'file mutation/archive delete disable', recovery: 'verified compensation or rehydration', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
  { signal: 'drive_dependency', threshold: 'any authorization/manifest failure', diagnostic: 'safe provider category and manifest hash', kill_switch: 'copy/proxy/delete disable', recovery: 'OAuth repair then read-back verification', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
  { signal: 'cloudflare_access_dependency', threshold: '15m>=3', diagnostic: 'safe Access authentication category', kill_switch: 'Cloudflare Access policy or deployment rollback', recovery: 'verify Access policy/JWKS then reauthenticate', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
  { signal: 'mcp_dependency', threshold: 'any auth/audit outage or sustained failures', diagnostic: 'safe tool/outcome aggregate', kill_switch: 'global or per-tool disable', recovery: 'Web remains authoritative; re-enable after conformance', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
  { signal: 'd1_dependency', threshold: 'any integrity/FK failure or sustained errors', diagnostic: 'integrity, FK and request aggregate', kill_switch: 'stop new writes/deployment rollback', recovery: 'isolated verified restore or forward recovery', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
  { signal: 'r2_dependency', threshold: 'any protected read/write/delete failure burst', diagnostic: 'safe storage operation category', kill_switch: 'upload/archive-delete disable', recovery: 'retry only after HEAD/checksum validation', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
  { signal: 'capacity', threshold: '>=80% approved D1/R2/Drive/provider envelope', diagnostic: 'anonymous counts and provider quotas', kill_switch: 'pause intake/background expansion', recovery: 'drain bounded backlog and owner capacity decision', escalation: 'PROVIDER_INDEPENDENT_REQUIRED' },
] as const;

export const EXTERNAL_RELEASE_GATES = [
  'CLOUDFLARE_ACCESS_APPLICATION_POLICY_AND_KNOWN_STAFF_EMAILS',
  'GOOGLE_DRIVE_OWNER_OAUTH_AND_REAL_PROXY_READ_DELETE',
  'OPENAI_CHATGPT_OAUTH_MCP_REGISTRATION_AND_AI_PRIVACY_APPROVAL',
  'CLOUDFLARE_ACCOUNT_DOMAIN_DNS_AND_PRODUCTION_SECRETS',
  'ONLINE_MIGRATION_DEPLOYMENT_SCHEDULER_QUEUE_R2_DRIVE_MCP_ENABLEMENT',
  'CHINA_MOBILE_UNICOM_TELECOM_AND_WECHAT_BROWSER_MATRIX',
  'PRIVACY_RETENTION_DELETION_AND_HISTORICAL_IMPORT_PREVIEW_APPROVAL',
  'FINAL_PRODUCTION_GO',
] as const;

export function validateProductionAlertControls(
  controls: readonly ProductionAlertControl[],
): void {
  const required = [
    'worker_5xx', 'login_anomaly', 'job_stale_or_backlog', 'file_integrity',
    'drive_dependency', 'cloudflare_access_dependency', 'mcp_dependency',
    'd1_dependency', 'r2_dependency', 'capacity',
  ];
  if (controls.length !== required.length
    || new Set(controls.map((control) => control.signal)).size !== required.length
    || required.some((signal) => !controls.some((control) => control.signal === signal))
    || controls.some((control) => !control.threshold || !control.diagnostic
      || !control.kill_switch || !control.recovery
      || control.escalation !== 'PROVIDER_INDEPENDENT_REQUIRED')) {
    throw new Error('invalid_production_alert_controls');
  }
}
