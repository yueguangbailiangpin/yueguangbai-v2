import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StaffMcpCurrentActor } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { D1StaffMcpApplicationService } from './d1-application-service';

describe('D1 Staff MCP application service', () => {
  let database: SqliteDatabase;
  beforeEach(() => {
    database = createMigratedTestDatabase();
    database.exec(`
      INSERT INTO buyer_channels (
        id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at
      ) VALUES ('mcp-d1-channel','D1M','D1 MCP','ACTIVE',1,1,1,1,NULL);
      INSERT INTO customer_identity_subjects (id,subject_type,created_at)
      VALUES ('mcp-d1-subject','BUYER_CUSTOMER',1);
      INSERT INTO buyer_customers (
        id,identity_subject_id,marketplace_code,buyer_channel_id,
        buyer_customer_no,buyer_sequence,first_valid_order_business_date,
        display_name,access_status,identity_review_status,version,
        created_at,updated_at,activated_at,disabled_at
      ) VALUES (
        'mcp-d1-buyer','mcp-d1-subject','JP','mcp-d1-channel',
        NULL,NULL,NULL,'匿名 D1 买家','ACTIVE','CLEAR',3,1,1,1,NULL
      );
    `);
  });
  afterEach(() => database.close());

  it('reads an authorized D1 fact without a mock service or write', async () => {
    const service = new D1StaffMcpApplicationService(database);
    const before = await database.prepare('SELECT COUNT(*) AS count FROM buyer_customers')
      .first();
    await expect(service.execute('get_customer_summary_v1', {
      customer_type: 'BUYER',
      customer_id: 'mcp-d1-buyer',
      marketplace_code: 'AMAZON_JP',
    }, actor(['BUYER_VIEW']))).resolves.toMatchObject({
      kind: 'FACT',
      data: { summary: { customer_id: 'mcp-d1-buyer', wechat_id: null } },
      sourceReferences: [{ object_type: 'BUYER', version: 3 }],
    });
    expect(await database.prepare('SELECT COUNT(*) AS count FROM buyer_customers').first())
      .toEqual(before);
  });

  it('honors current permission scope and keeps screenshot bytes unavailable', async () => {
    const service = new D1StaffMcpApplicationService(database);
    await expect(service.execute('get_customer_summary_v1', {
      customer_type: 'BUYER',
      customer_id: 'mcp-d1-buyer',
      marketplace_code: 'AMAZON_JP',
    }, actor([]))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.execute('read_task_screenshot_v1', {
      task_id: 'mcp-task', screenshot_kind: 'REVIEW_EVIDENCE',
    }, actor(['TASK_VIEW_OPEN']))).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    await expect(service.execute('list_staff_exceptions_v1', {
      limit: 20, cursor: null, category: null,
    }, actor([]))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

function actor(
  permissions: readonly ('BUYER_VIEW' | 'TASK_VIEW_OPEN')[],
): StaffMcpCurrentActor {
  return {
    staffId: 'zz-phase3h-test-owner',
    displayName: '匿名 Owner',
    authorizationVersion: 1,
    role: 'owner',
    permissions: new Set(permissions),
    dataScope: {
      type: 'GLOBAL', buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [],
      marketplaceCodes: [],
    },
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}
