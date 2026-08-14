import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMigrations,
  SqliteDatabase,
} from '@ygb/testkit';
import {
  confirmBuyerDailyExchangeRate,
  submitBuyerDailyExchangeRate,
} from '../apps/api/src/pricing/buyer-daily-exchange-rates.ts';
import {
  confirmSellerPrincipalRatePolicy,
  submitSellerPrincipalRatePolicy,
} from '../apps/api/src/pricing/seller-principal-rate-policy.ts';
import {
  inspectSellerPrincipalRateActivation,
  inspectSellerPrincipalRateTemplates,
  openReadOnlyActivationDatabase,
} from './preflight-seller-principal-rate-activation.mjs';

const AS_OF = 5_000;
const owner = {
  staffId: 'preflight-owner', displayName: '总管理员', roles: ['owner'],
};
const sellerOps = {
  staffId: 'preflight-seller-ops', displayName: '卖家对接', roles: ['seller_ops'],
};

let workDirectory = null;
let databasePath = null;
let writer = null;

afterEach(() => {
  writer?.close();
  writer = null;
  if (workDirectory) rmSync(workDirectory, { recursive: true, force: true });
  workDirectory = null;
  databasePath = null;
});

describe('seller-principal rate activation preflight', () => {
  it('keeps both release templates disabled with zero external work', () => {
    expect(inspectSellerPrincipalRateTemplates()).toEqual(expect.objectContaining({
      status: 'LOCAL_TEMPLATE_SAFE_PRODUCTION_BLOCKED',
      migration_decision: 'NONE',
      environments: ['staging', 'production'],
      enforcement_enabled: false,
      external_calls: 0,
      database_reads: 0,
      database_writes: 0,
      policy_mutations: 0,
      deployments: 0,
      resource_mutations: 0,
      production_ready: false,
      errors: [],
    }));
  });

  it('plans one version and two conserved command facts when no row exists', () => {
    createFixture();
    closeWriter();
    const before = fileHash(databasePath);
    const first = inspect({ phase: 'bootstrap' });
    const second = inspect({ phase: 'bootstrap' });

    expect(first).toMatchObject({
      status: 'LOCAL_READY_STAFF_CONFIGURATION_REQUIRED',
      migration_decision: 'NONE',
      schema_version: 68,
      integrity_check: 'ok',
      foreign_key_errors: 0,
      database_writes: 0,
      policy_mutations: 0,
      production_ready: false,
      policy_state: {
        recommended_action: 'SUBMIT_AND_OWNER_CONFIRM',
        latest_default_version: 0,
        next_expected_version: 1,
        current_default: null,
        pending_default: null,
        expected_row_deltas: {
          policy_versions: 1,
          policy_events: 2,
          audit_events: 2,
          outbox_events: 2,
          committed_idempotency_records: 2,
          historical_order_updates: 0,
          principal_snapshot_updates: 0,
        },
      },
      conservation: {
        policy_versions_total: 0,
        fact_graph_anomalies: 0,
      },
    });
    expect(second).toEqual(first);
    expect(fileHash(databasePath)).toBe(before);
  });

  it('classifies a correct future pending row as Owner confirmation only', async () => {
    createFixture();
    await seedDefaultPolicy({ markup: '0.004', effectiveFrom: 8_000 });
    closeWriter();

    expect(inspect({ phase: 'bootstrap' })).toMatchObject({
      status: 'LOCAL_READY_STAFF_CONFIGURATION_REQUIRED',
      errors: [],
      policy_state: {
        recommended_action: 'OWNER_CONFIRM_EXISTING',
        pending_default: {
          status: 'SUBMITTED',
          markup_rate_value: '400000',
          explicit_zero: false,
        },
        expected_row_deltas: {
          policy_versions: 0,
          policy_events: 1,
          audit_events: 1,
          outbox_events: 1,
          committed_idempotency_records: 1,
        },
      },
      conservation: {
        policy_versions_total: 1,
        policy_events_total: 1,
        audit_events_total: 1,
        outbox_events_total: 1,
        committed_idempotency_total: 1,
        fact_graph_anomalies: 0,
      },
    });
  });

  it('blocks a redundant pending row when a correct future version is already confirmed', async () => {
    createFixture();
    const future = await seedDefaultPolicy({
      markup: '0.004', effectiveFrom: 8_000,
    });
    await confirmPolicy(future.policy_version_id, 2_000);
    await seedDefaultPolicy({
      markup: '0.004', effectiveFrom: 9_000, expectedVersion: 1,
    });
    closeWriter();

    expect(inspect({ phase: 'bootstrap' })).toMatchObject({
      status: 'BLOCKED',
      errors: ['default_policy:manual_review_required'],
      policy_state: {
        recommended_action: 'BLOCKED_MANUAL_REVIEW',
        next_required_future_default: {
          status: 'CONFIRMED', markup_rate_value: '400000',
        },
        pending_default: {
          status: 'SUBMITTED', markup_rate_value: '400000',
        },
      },
      database_writes: 0,
    });
  });

  it('keeps explicit zero distinct from an unset or required default', async () => {
    createFixture();
    const submitted = await seedDefaultPolicy({
      markup: '0', effectiveFrom: 3_000,
    });
    await confirmPolicy(submitted.policy_version_id, 2_000);
    closeWriter();

    expect(inspect({ phase: 'bootstrap' })).toMatchObject({
      status: 'LOCAL_READY_STAFF_CONFIGURATION_REQUIRED',
      errors: [],
      policy_state: {
        recommended_action: 'SUBMIT_AND_OWNER_CONFIRM',
        current_default: {
          markup_rate_value: '0', explicit_zero: true,
        },
      },
      conservation: {
        explicit_zero_default_versions: 1,
        fact_graph_anomalies: 0,
      },
    });
  });

  it('requires the effective default and an exact-date base rate for enablement', async () => {
    createFixture();
    const submitted = await seedDefaultPolicy({
      markup: '0.004', effectiveFrom: 3_000,
    });
    await confirmPolicy(submitted.policy_version_id, 2_000);
    await seedBaseRate('2026-08-10');
    closeWriter();

    const result = inspect({
      phase: 'enablement', businessDates: ['2026-08-10'],
    });
    expect(result).toMatchObject({
      status: 'LOCAL_READY_PRODUCTION_BLOCKED',
      errors: [],
      enforcement_enabled: false,
      production_ready: false,
      policy_state: {
        recommended_action: 'NO_POLICY_MUTATION_REQUIRED',
        expected_row_deltas: {
          policy_versions: 0,
          policy_events: 0,
          audit_events: 0,
          outbox_events: 0,
          committed_idempotency_records: 0,
        },
      },
      exact_date_rate_checks: [{
        business_date: '2026-08-10',
        available: true,
        selected_version_no: 1,
        selected_rate_value: '5100000',
        selected_rate_scale: '100000000',
      }],
    });
  });

  it('does not fall back to a nearby date and blocks a conflicting pending row', async () => {
    createFixture();
    await seedDefaultPolicy({ markup: '0', effectiveFrom: 8_000 });
    await seedBaseRate('2026-08-09');
    closeWriter();

    expect(inspect({
      phase: 'enablement', businessDates: ['2026-08-10'],
    })).toMatchObject({
      status: 'BLOCKED',
      errors: expect.arrayContaining([
        'default_policy:manual_review_required',
      ]),
      policy_state: {
        recommended_action: 'BLOCKED_MANUAL_REVIEW',
        pending_default: {
          markup_rate_value: '0', explicit_zero: true,
        },
      },
      exact_date_rate_checks: [{
        business_date: '2026-08-10', available: false,
      }],
      database_writes: 0,
    });
  });

  it('blocks a policy row that bypassed event, Audit, Outbox and idempotency facts', () => {
    createFixture();
    writer.exec(`
      INSERT INTO seller_principal_rate_policy_versions (
        id, scope_type, seller_organization_id, source_currency_code,
        quote_currency_code, version_no, status, markup_rate_value, rate_scale,
        effective_from, submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at, rejected_by_staff_id, rejected_at,
        rejection_reason
      ) VALUES (
        'preflight-direct-policy', 'CURRENCY_PAIR_DEFAULT', NULL, 'JPY', 'CNY',
        1, 'SUBMITTED', 400000, 100000000, 8000,
        'preflight-seller-ops', 1000, 1, NULL, NULL, NULL, NULL, NULL
      );
    `);
    closeWriter();

    expect(inspect({ phase: 'bootstrap' })).toMatchObject({
      status: 'BLOCKED',
      errors: expect.arrayContaining(['policy_fact_graph:anomaly']),
      conservation: {
        policy_versions_total: 1,
        policy_events_total: 0,
        audit_events_total: 0,
        outbox_events_total: 0,
        committed_idempotency_total: 0,
        fact_graph_anomalies: 1,
      },
      database_writes: 0,
    });
  });
});

function createFixture() {
  workDirectory = mkdtempSync(path.join(tmpdir(), 'ygb-principal-preflight-'));
  databasePath = path.join(workDirectory, 'restored.sqlite');
  writer = new SqliteDatabase(databasePath);
  applyMigrations(writer);
  writer.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('preflight-owner', '总管理员', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('preflight-seller-ops', '卖家对接', 'ACTIVE', 1, 1, 1, 1, NULL);
  `);
}

async function seedDefaultPolicy({ markup, effectiveFrom, expectedVersion = 0 }) {
  return submitSellerPrincipalRatePolicy(writer, {
    scopeType: 'CURRENCY_PAIR_DEFAULT',
    sellerOrganizationId: null,
    sourceCurrencyCode: 'JPY',
    markupRateValue: markup,
    expectedVersion,
    effectiveFrom,
  }, command(
    sellerOps, `preflight-policy-submit-${markup}-${effectiveFrom}`, 1_000,
  ));
}

async function confirmPolicy(policyVersionId, now) {
  return confirmSellerPrincipalRatePolicy(writer, {
    policyVersionId, expectedVersion: 1,
  }, command(owner, `preflight-policy-confirm-${policyVersionId}`, now));
}

async function seedBaseRate(businessDate) {
  const submitted = await submitBuyerDailyExchangeRate(writer, {
    businessDate, cnyPerJpyE8: '5100000', expectedVersion: 0,
  }, command(sellerOps, `preflight-base-submit-${businessDate}`, 1_000));
  await confirmBuyerDailyExchangeRate(writer, {
    rateId: submitted.rate_id, expectedVersion: 1,
  }, command(owner, `preflight-base-confirm-${businessDate}`, 2_000));
}

function inspect({ phase, businessDates = [] }) {
  const reader = openReadOnlyActivationDatabase(databasePath);
  try {
    return inspectSellerPrincipalRateActivation(reader, {
      phase,
      expectedSchemaVersion: 68,
      asOf: AS_OF,
      enforcementState: 'false',
      businessDates,
    });
  } finally {
    reader.close();
  }
}

function command(actor, idempotencyKey, now) {
  return {
    actor, idempotencyKey,
    requestId: `${idempotencyKey}:request`,
    now,
  };
}

function closeWriter() {
  writer?.close();
  writer = null;
}

function fileHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
