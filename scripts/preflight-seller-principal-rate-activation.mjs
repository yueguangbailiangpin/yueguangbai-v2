import { DatabaseSync } from 'node:sqlite';
import {
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readLocalReleaseConfig,
  templatePath,
} from './preflight-cloudflare-release.mjs';

const TARGET_MARKUP = 400_000n;
const RATE_SCALE = 100_000_000n;
const POLICY_KIND = 'SELLER_PRINCIPAL_RATE_POLICY';
const relevantActions = new Set([
  'SUBMIT_SELLER_PRINCIPAL_RATE_POLICY',
  'CONFIRM_SELLER_PRINCIPAL_RATE_POLICY',
  'REJECT_SELLER_PRINCIPAL_RATE_POLICY',
]);

export function inspectSellerPrincipalRateTemplates() {
  const environments = ['staging', 'production'];
  const errors = [];
  for (const environment of environments) {
    const template = readLocalReleaseConfig(templatePath(environment));
    if (template?.vars?.SELLER_PRINCIPAL_RATE_ENFORCEMENT_ENABLED !== 'false') {
      errors.push(`${environment}.enforcement:must_be_explicit_false`);
    }
  }
  return Object.freeze({
    status: errors.length === 0
      ? 'LOCAL_TEMPLATE_SAFE_PRODUCTION_BLOCKED'
      : 'BLOCKED',
    migration_decision: 'NONE',
    environments,
    enforcement_enabled: false,
    errors: Object.freeze(errors),
    external_calls: 0,
    database_reads: 0,
    database_writes: 0,
    policy_mutations: 0,
    deployments: 0,
    resource_mutations: 0,
    production_ready: false,
  });
}

export function openReadOnlyActivationDatabase(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    throw new Error('database_path:not_absolute');
  }
  let real;
  try {
    real = realpathSync.native(file);
    if (!statSync(real).isFile()) throw new Error('not_file');
  } catch {
    throw new Error('database_path:unreadable_or_not_file');
  }
  const database = new DatabaseSync(real, { readOnly: true });
  database.exec('PRAGMA query_only=ON; PRAGMA foreign_keys=ON;');
  return database;
}

export function inspectSellerPrincipalRateActivation(database, input) {
  const beforeChanges = totalChanges(database);
  const phase = input?.phase;
  const expectedSchemaVersion = input?.expectedSchemaVersion;
  const asOf = input?.asOf;
  const enforcementState = input?.enforcementState;
  let businessDates = [];
  const errors = [];

  try {
    businessDates = normalizeBusinessDates(input?.businessDates ?? []);
  } catch {
    errors.push('business_date:invalid');
  }

  if (phase !== 'bootstrap' && phase !== 'enablement') {
    errors.push('phase:invalid');
  }
  if (!Number.isSafeInteger(expectedSchemaVersion)
    || expectedSchemaVersion !== 43) {
    errors.push('expected_schema:must_be_43');
  }
  if (!Number.isSafeInteger(asOf) || asOf < 0) {
    errors.push('as_of:invalid');
  }
  if (enforcementState !== 'false') {
    errors.push('enforcement_state:must_be_explicit_false');
  }
  if (phase === 'enablement' && businessDates.length === 0) {
    errors.push('business_date:required_for_enablement');
  }
  if (errors.length > 0) {
    return baseResult({
      status: 'BLOCKED', phase, expectedSchemaVersion, asOf,
      enforcementState, errors, databaseWrites: changeDelta(database, beforeChanges),
    });
  }

  let schemaVersion;
  try {
    schemaVersion = Number(database.prepare(`
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `).get()?.schema_version);
  } catch {
    errors.push('schema_state:unavailable');
  }
  if (schemaVersion !== expectedSchemaVersion) {
    errors.push('schema_version:mismatch');
  }
  if (errors.length > 0) {
    return baseResult({
      status: 'BLOCKED', phase, expectedSchemaVersion, schemaVersion, asOf,
      enforcementState, errors, databaseWrites: changeDelta(database, beforeChanges),
    });
  }

  const integrityRows = database.prepare('PRAGMA integrity_check').all();
  const integrityCheck = integrityRows.length === 1
    ? String(integrityRows[0]?.integrity_check ?? '')
    : 'invalid';
  const foreignKeyErrors = database.prepare('PRAGMA foreign_key_check').all().length;
  if (integrityCheck !== 'ok') errors.push('integrity_check:failed');
  if (foreignKeyErrors !== 0) errors.push('foreign_key_check:failed');

  let facts;
  let conservation;
  let classification;
  let rateChecks = [];
  if (errors.length === 0) {
    facts = readPolicyFacts(database);
    conservation = analyzeConservation(facts);
    if (conservation.fact_graph_anomalies !== 0) {
      errors.push('policy_fact_graph:anomaly');
    }
    classification = classifyDefaultPolicy(facts.policies, asOf);
    if (classification.recommended_action === 'BLOCKED_MANUAL_REVIEW') {
      errors.push('default_policy:manual_review_required');
    }
    rateChecks = businessDates.map((businessDate) => (
      inspectExactDateRate(database, businessDate, asOf)
    ));
  }

  if (phase === 'enablement' && errors.length === 0) {
    if (classification.recommended_action !== 'NO_POLICY_MUTATION_REQUIRED') {
      errors.push('default_policy:not_currently_effective');
    }
    if (rateChecks.some((check) => !check.available)) {
      errors.push('exact_date_rate:missing');
    }
  }

  const databaseWrites = changeDelta(database, beforeChanges);
  if (databaseWrites !== 0) errors.push('database:unexpected_write');
  const status = resultStatus(phase, classification, errors);

  return Object.freeze({
    ...baseResult({
      status, phase, expectedSchemaVersion, schemaVersion, asOf,
      enforcementState, errors, databaseWrites,
    }),
    integrity_check: integrityCheck,
    foreign_key_errors: foreignKeyErrors,
    target: Object.freeze({
      scope_type: 'CURRENCY_PAIR_DEFAULT',
      seller_organization_id: null,
      source_currency_code: 'JPY',
      quote_currency_code: 'CNY',
      required_markup_rate_value: String(TARGET_MARKUP),
      rate_scale: String(RATE_SCALE),
    }),
    policy_state: classification ? Object.freeze(classification) : null,
    conservation: conservation ? Object.freeze(conservation) : null,
    exact_date_rate_checks: Object.freeze(rateChecks),
  });
}

function readPolicyFacts(database) {
  const policies = database.prepare(`
    SELECT id, scope_type, seller_organization_id, source_currency_code,
      quote_currency_code, version_no, status, markup_rate_value, rate_scale,
      effective_from, submitted_by_staff_id, submitted_at,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at
    FROM seller_principal_rate_policy_versions
  `).all();
  const events = database.prepare(`
    SELECT version_id, event_type, actor_staff_id, idempotency_key
    FROM seller_principal_rate_policy_events
  `).all();
  const audits = database.prepare(`
    SELECT aggregate_id, event_type, actor_id, idempotency_key
    FROM audit_events
    WHERE aggregate_type=?
  `).all(POLICY_KIND);
  const outbox = database.prepare(`
    SELECT aggregate_id, event_type
    FROM integration_outbox
    WHERE aggregate_type=?
  `).all(POLICY_KIND);
  const idempotency = database.prepare(`
    SELECT actor_id, idempotency_key, action, status
    FROM command_idempotency_records
    WHERE actor_type='STAFF'
      AND action IN (
        'SUBMIT_SELLER_PRINCIPAL_RATE_POLICY',
        'CONFIRM_SELLER_PRINCIPAL_RATE_POLICY',
        'REJECT_SELLER_PRINCIPAL_RATE_POLICY'
      )
  `).all();
  return { policies, events, audits, outbox, idempotency };
}

function analyzeConservation(facts) {
  const policyById = new Map(facts.policies.map((row) => [String(row.id), row]));
  const expectedEventKeys = new Set();
  let anomalies = 0;
  for (const policy of facts.policies) {
    const id = String(policy.id);
    expectedEventKeys.add(`${id}|SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED`);
    if (policy.status === 'CONFIRMED') {
      expectedEventKeys.add(`${id}|SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED`);
    } else if (policy.status === 'REJECTED') {
      expectedEventKeys.add(`${id}|SELLER_PRINCIPAL_RATE_POLICY_REJECTED`);
    }
  }

  const actualEventCounts = countBy(facts.events, (event) => (
    `${String(event.version_id)}|${String(event.event_type)}`
  ));
  for (const expected of expectedEventKeys) {
    if (actualEventCounts.get(expected) !== 1) anomalies += 1;
  }
  for (const event of facts.events) {
    const key = `${String(event.version_id)}|${String(event.event_type)}`;
    if (!expectedEventKeys.has(key) || !policyById.has(String(event.version_id))) {
      anomalies += 1;
    }
    const auditMatches = facts.audits.filter((audit) => (
      audit.aggregate_id === event.version_id
      && audit.event_type === event.event_type
      && audit.actor_id === event.actor_staff_id
      && audit.idempotency_key === event.idempotency_key
    )).length;
    if (auditMatches !== 1) anomalies += 1;
    const outboxMatches = facts.outbox.filter((item) => (
      item.aggregate_id === event.version_id
      && item.event_type === event.event_type
    )).length;
    if (outboxMatches !== 1) anomalies += 1;
    const action = actionForEvent(String(event.event_type));
    const idempotencyMatches = facts.idempotency.filter((record) => (
      record.actor_id === event.actor_staff_id
      && record.idempotency_key === event.idempotency_key
      && record.action === action
      && record.status === 'COMMITTED'
    )).length;
    if (idempotencyMatches !== 1) anomalies += 1;
  }

  anomalies += facts.audits.filter((audit) => !facts.events.some((event) => (
    audit.aggregate_id === event.version_id
    && audit.event_type === event.event_type
    && audit.actor_id === event.actor_staff_id
    && audit.idempotency_key === event.idempotency_key
  ))).length;
  anomalies += facts.outbox.filter((item) => !facts.events.some((event) => (
    item.aggregate_id === event.version_id && item.event_type === event.event_type
  ))).length;
  anomalies += facts.idempotency.filter((record) => (
    record.status === 'COMMITTED'
    && relevantActions.has(String(record.action))
    && !facts.events.some((event) => (
      event.actor_staff_id === record.actor_id
      && event.idempotency_key === record.idempotency_key
      && actionForEvent(String(event.event_type)) === record.action
    ))
  )).length;

  return {
    policy_versions_total: facts.policies.length,
    default_policy_versions: facts.policies.filter((row) => (
      row.scope_type === 'CURRENCY_PAIR_DEFAULT'
    )).length,
    organization_override_versions: facts.policies.filter((row) => (
      row.scope_type === 'SELLER_ORGANIZATION'
    )).length,
    explicit_zero_default_versions: facts.policies.filter((row) => (
      row.scope_type === 'CURRENCY_PAIR_DEFAULT'
      && BigInt(row.markup_rate_value) === 0n
    )).length,
    explicit_zero_organization_versions: facts.policies.filter((row) => (
      row.scope_type === 'SELLER_ORGANIZATION'
      && BigInt(row.markup_rate_value) === 0n
    )).length,
    policy_events_total: facts.events.length,
    audit_events_total: facts.audits.length,
    outbox_events_total: facts.outbox.length,
    committed_idempotency_total: facts.idempotency.filter((row) => (
      row.status === 'COMMITTED'
    )).length,
    fact_graph_anomalies: anomalies,
  };
}

function classifyDefaultPolicy(policies, asOf) {
  const defaults = policies.filter((row) => (
    row.scope_type === 'CURRENCY_PAIR_DEFAULT'
    && row.seller_organization_id === null
    && row.source_currency_code === 'JPY'
    && row.quote_currency_code === 'CNY'
  ));
  const pending = defaults.filter((row) => row.status === 'SUBMITTED');
  const confirmed = defaults.filter((row) => row.status === 'CONFIRMED');
  const current = confirmed
    .filter((row) => Number(row.effective_from) <= asOf
      && Number(row.confirmed_at) <= asOf)
    .sort(compareEffectiveDesc)[0] ?? null;
  const future = confirmed
    .filter((row) => Number(row.effective_from) > asOf)
    .sort(compareEffectiveAsc);
  const futureWrong = future.filter((row) => !isRequiredPolicy(row));
  const futureRequired = future.filter(isRequiredPolicy);
  const latestVersion = defaults.reduce(
    (latest, row) => Math.max(latest, Number(row.version_no)), 0,
  );

  let recommendedAction;
  let expectedRowDeltas;
  if (pending.length > 1 || futureWrong.length > 0) {
    recommendedAction = 'BLOCKED_MANUAL_REVIEW';
    expectedRowDeltas = unknownDeltas();
  } else if (pending.length === 1) {
    const candidate = pending[0];
    if (isRequiredPolicy(candidate)
      && Number(candidate.effective_from) > asOf
      && futureRequired.length === 0
      && !isRequiredPolicy(current)) {
      recommendedAction = 'OWNER_CONFIRM_EXISTING';
      expectedRowDeltas = deltas(0, 1);
    } else {
      recommendedAction = 'BLOCKED_MANUAL_REVIEW';
      expectedRowDeltas = unknownDeltas();
    }
  } else if (isRequiredPolicy(current)) {
    recommendedAction = 'NO_POLICY_MUTATION_REQUIRED';
    expectedRowDeltas = deltas(0, 0);
  } else if (futureRequired.length > 0) {
    recommendedAction = 'WAIT_FOR_EFFECTIVE_BOUNDARY';
    expectedRowDeltas = deltas(0, 0);
  } else {
    recommendedAction = 'SUBMIT_AND_OWNER_CONFIRM';
    expectedRowDeltas = deltas(1, 2);
  }

  return {
    recommended_action: recommendedAction,
    latest_default_version: latestVersion,
    next_expected_version: latestVersion + 1,
    current_default: policySummary(current),
    pending_default: policySummary(pending[0] ?? null),
    next_required_future_default: policySummary(futureRequired[0] ?? null),
    expected_row_deltas: Object.freeze(expectedRowDeltas),
  };
}

function inspectExactDateRate(database, businessDate, asOf) {
  const rows = database.prepare(`
    SELECT version_no, rate_value, rate_scale, confirmed_at
    FROM buyer_daily_currency_rate_versions
    WHERE business_date=?
      AND source_currency_code='JPY'
      AND quote_currency_code='CNY'
      AND status='CONFIRMED'
      AND confirmed_at<=?
    ORDER BY version_no DESC
  `).all(businessDate, asOf);
  const selected = rows[0] ?? null;
  return Object.freeze({
    business_date: businessDate,
    available: selected !== null && BigInt(selected.rate_scale) === RATE_SCALE,
    confirmed_versions: rows.length,
    selected_version_no: selected ? Number(selected.version_no) : null,
    selected_rate_value: selected ? String(selected.rate_value) : null,
    selected_rate_scale: selected ? String(selected.rate_scale) : null,
  });
}

function baseResult(input) {
  return Object.freeze({
    status: input.status,
    phase: input.phase ?? null,
    migration_decision: 'NONE',
    expected_schema_version: input.expectedSchemaVersion ?? null,
    schema_version: Number.isSafeInteger(input.schemaVersion)
      ? input.schemaVersion : null,
    as_of: Number.isSafeInteger(input.asOf) ? input.asOf : null,
    enforcement_enabled: input.enforcementState === 'false' ? false : null,
    errors: Object.freeze([...input.errors]),
    external_calls: 0,
    database_reads: input.databaseReads ?? 1,
    database_writes: input.databaseWrites,
    policy_mutations: 0,
    deployments: 0,
    resource_mutations: 0,
    production_ready: false,
  });
}

function resultStatus(phase, classification, errors) {
  if (errors.length > 0) return 'BLOCKED';
  if (phase === 'enablement') return 'LOCAL_READY_PRODUCTION_BLOCKED';
  switch (classification.recommended_action) {
    case 'NO_POLICY_MUTATION_REQUIRED':
      return 'LOCAL_POLICY_READY_PRODUCTION_BLOCKED';
    case 'WAIT_FOR_EFFECTIVE_BOUNDARY':
      return 'LOCAL_WAITING_EFFECTIVE_PRODUCTION_BLOCKED';
    default:
      return 'LOCAL_READY_STAFF_CONFIGURATION_REQUIRED';
  }
}

function policySummary(row) {
  if (!row) return null;
  return Object.freeze({
    status: String(row.status),
    version_no: Number(row.version_no),
    markup_rate_value: String(row.markup_rate_value),
    rate_scale: String(row.rate_scale),
    explicit_zero: BigInt(row.markup_rate_value) === 0n,
    effective_from: Number(row.effective_from),
    confirmed_at: row.confirmed_at === null ? null : Number(row.confirmed_at),
  });
}

function isRequiredPolicy(row) {
  return row !== null
    && BigInt(row.markup_rate_value) === TARGET_MARKUP
    && BigInt(row.rate_scale) === RATE_SCALE;
}

function compareEffectiveDesc(left, right) {
  return Number(right.effective_from) - Number(left.effective_from)
    || Number(right.version_no) - Number(left.version_no);
}

function compareEffectiveAsc(left, right) {
  return Number(left.effective_from) - Number(right.effective_from)
    || Number(left.version_no) - Number(right.version_no);
}

function deltas(policyVersions, events) {
  return {
    policy_versions: policyVersions,
    policy_events: events,
    audit_events: events,
    outbox_events: events,
    committed_idempotency_records: events,
    historical_order_updates: 0,
    principal_snapshot_updates: 0,
  };
}

function unknownDeltas() {
  return {
    policy_versions: null,
    policy_events: null,
    audit_events: null,
    outbox_events: null,
    committed_idempotency_records: null,
    historical_order_updates: 0,
    principal_snapshot_updates: 0,
  };
}

function actionForEvent(eventType) {
  if (eventType === 'SELLER_PRINCIPAL_RATE_POLICY_SUBMITTED') {
    return 'SUBMIT_SELLER_PRINCIPAL_RATE_POLICY';
  }
  if (eventType === 'SELLER_PRINCIPAL_RATE_POLICY_CONFIRMED') {
    return 'CONFIRM_SELLER_PRINCIPAL_RATE_POLICY';
  }
  if (eventType === 'SELLER_PRINCIPAL_RATE_POLICY_REJECTED') {
    return 'REJECT_SELLER_PRINCIPAL_RATE_POLICY';
  }
  return null;
}

function countBy(rows, keyFor) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function normalizeBusinessDates(values) {
  const result = [];
  for (const value of values) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      throw new Error('business_date:invalid');
    }
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.valueOf())
      || date.toISOString().slice(0, 10) !== value) {
      throw new Error('business_date:invalid');
    }
    if (!result.includes(value)) result.push(value);
  }
  return result.sort();
}

function totalChanges(database) {
  return Number(database.prepare('SELECT total_changes() AS count').get()?.count ?? 0);
}

function changeDelta(database, before) {
  return totalChanges(database) - before;
}

function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (!current?.startsWith('--')) throw new Error('arguments:invalid');
    const key = current.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`arguments:${key}_missing`);
    if (key === 'business-date') {
      result.set(key, [...(result.get(key) ?? []), next]);
    } else if (result.has(key)) {
      throw new Error(`arguments:${key}_duplicate`);
    } else {
      result.set(key, next);
    }
    index += 1;
  }
  return result;
}

function runCli(values) {
  if (values.length === 0) {
    print(inspectSellerPrincipalRateTemplates());
    return;
  }
  let database;
  try {
    const argumentsMap = parseArguments(values);
    const allowed = new Set([
      'database', 'expected-schema', 'phase', 'as-of',
      'enforcement-state', 'business-date',
    ]);
    for (const key of argumentsMap.keys()) {
      if (!allowed.has(key)) throw new Error(`arguments:${key}_unknown`);
    }
    database = openReadOnlyActivationDatabase(required(argumentsMap, 'database'));
    const result = inspectSellerPrincipalRateActivation(database, {
      expectedSchemaVersion: integerArgument(argumentsMap, 'expected-schema'),
      phase: required(argumentsMap, 'phase'),
      asOf: integerArgument(argumentsMap, 'as-of'),
      enforcementState: required(argumentsMap, 'enforcement-state'),
      businessDates: argumentsMap.get('business-date') ?? [],
    });
    print(result);
  } catch (error) {
    print(baseResult({
      status: 'BLOCKED', phase: null, expectedSchemaVersion: null,
      asOf: null, enforcementState: null,
      errors: [safeError(error)], databaseWrites: 0, databaseReads: 0,
    }));
  } finally {
    database?.close();
  }
}

function required(values, key) {
  const value = values.get(key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`arguments:${key}_required`);
  }
  return value;
}

function integerArgument(values, key) {
  const raw = required(values, key);
  if (!/^\d+$/u.test(raw)) throw new Error(`arguments:${key}_invalid`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`arguments:${key}_invalid`);
  return value;
}

function safeError(error) {
  const message = error instanceof Error ? error.message : 'preflight:failed';
  return /^[a-z0-9_:-]+$/u.test(message) ? message : 'preflight:failed';
}

function print(result) {
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'BLOCKED') process.exitCode = 1;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2));
}
