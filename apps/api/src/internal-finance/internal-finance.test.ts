import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';
import type {
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { requireFinancialActor } from './shared';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('Wave 12 migration and authorization boundaries', () => {
  it('preserves Wave 12 finance authority on schema 28', async () => {
    database = createMigratedTestDatabase();
    const schema = await database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).first<{ schema_version: number }>();
    expect(Number(schema?.schema_version)).toBe(32);
    const objects = await database.prepare(`
      SELECT type, name FROM sqlite_schema
      WHERE name IN (
        'internal_order_finance_positions','internal_finance_exceptions',
        'internal_finance_cash_movements','financial_export_events',
        'trg_financial_export_events_no_update',
        'trg_financial_export_events_no_delete'
      ) ORDER BY name
    `).all();
    expect(objects.results).toHaveLength(6);
    const defaults = await database.prepare(`
      SELECT role_code FROM staff_assignment_role_permission_defaults
      WHERE permission_code='FINANCIAL_VIEW' ORDER BY role_code
    `).all<{ role_code: string }>();
    expect(defaults.results).toEqual([{ role_code: 'owner' }]);
  });


  it('keeps export events immutable', async () => {
    database = createMigratedTestDatabase();
    await database.prepare(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES ('finance-owner','Owner','ACTIVE',1,1,1,1,NULL)
    `).run();
    await database.prepare(`
      INSERT INTO financial_export_events (
        id, export_type, requested_by_staff_id, filter_json, filter_hash,
        data_as_of, row_count, output_byte_length, output_sha256,
        request_id, generated_at, created_at
      ) VALUES (
        'export-immutable-0001','ORDER_DETAIL','finance-owner','{}',
        ?,1,0,1,?,'request-1',1,1
      )
    `).bind('a'.repeat(64), 'b'.repeat(64)).run();
    await expect(database.prepare(`
      UPDATE financial_export_events SET row_count=1
      WHERE id='export-immutable-0001'
    `).run()).rejects.toThrow('financial_export_events_are_immutable');
    await expect(database.prepare(`
      DELETE FROM financial_export_events WHERE id='export-immutable-0001'
    `).run()).rejects.toThrow('financial_export_events_are_immutable');
  });

  it('requires owner, FINANCIAL_VIEW and honors personal DENY', () => {
    const owner = actor(['owner'], ['FINANCIAL_VIEW', 'FINANCIAL_EXPORT']);
    expect(requireFinancialActor(owner)).toBe(owner);
    expect(requireFinancialActor(owner, { export: true })).toBe(owner);

    const nonOwnerEffective = calculateEffectiveStaffAuthorization({
      roles: new Set<StaffRoleCode>(['seller_ops']),
      grants: new Set<StaffPermissionCode>(['FINANCIAL_VIEW']),
      denies: new Set<StaffPermissionCode>(),
      memberTeamIds: ['team'],
      leaderTeamIds: [],
    });
    expect(nonOwnerEffective.permissions.has('FINANCIAL_VIEW')).toBe(false);

    const denied = actor(['owner'], ['FINANCIAL_EXPORT']);
    expect(() => requireFinancialActor(denied)).toThrow('FORBIDDEN');
    expect(() => requireFinancialActor(undefined)).toThrow('UNAUTHENTICATED');
  });
});


function actor(
  roles: readonly StaffRoleCode[],
  permissions: readonly StaffPermissionCode[],
): AssignmentStaffAuthorization {
  return {
    staffId: 'staff',
    displayName: 'Staff',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(roles),
    permissions: new Set(permissions),
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}
