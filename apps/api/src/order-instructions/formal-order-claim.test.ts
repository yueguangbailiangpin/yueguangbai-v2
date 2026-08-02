import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'migrations/0021_order_instructions.sql'),
  'utf8',
);
const integration = readFileSync(
  join(process.cwd(), 'apps/api/src/order-instructions/formal-order-integration.ts'),
  'utf8',
);

describe('formal order number claim model', () => {
  it('uses a database unique active marketplace/order key', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX\s+uq_formal_order_number_claims_active[\s\S]+marketplace_code\s*,\s*amazon_order_number_normalized[\s\S]+WHERE status IN \('PROVISIONAL','FINAL'\)/u);
  });

  it('records historical conflicts separately', () => {
    expect(migration).toContain('CREATE TABLE formal_order_number_conflicts');
    expect(migration).toContain('json_group_array');
  });

  it('does not add a breaking unique index to formal_orders', () => {
    expect(migration).not.toMatch(/CREATE UNIQUE INDEX[^;]+ON formal_orders[^;]+amazon_order_number/su);
  });

  it('creates provisional claims and finalizes them in the confirmation transaction', () => {
    expect(integration).toContain('INSERT INTO formal_order_number_claims');
    expect(integration).toContain("SET status='FINAL'");
  });

  it('distinguishes historical conflict from an occupied claim', () => {
    expect(integration).toContain('ORDER_NUMBER_CONFLICT_REQUIRES_REVIEW');
    expect(integration).toContain('ORDER_NUMBER_ALREADY_CLAIMED');
  });
});
