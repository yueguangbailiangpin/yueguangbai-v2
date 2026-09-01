import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { listHistoricalSellerDirectory } from './historical-seller-directory';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('historical seller directory', () => {
  it('lists frozen historical organizations without creating acquisition leads', async () => {
    database = createMigratedTestDatabase();
    database.raw.exec(`
      INSERT INTO customer_identity_subjects(id,subject_type,created_at)
      VALUES('historical-subject-1','SELLER_ORG_MEMBER',1000);
      INSERT INTO wechat_identity_claims(
        id,identity_subject_id,display_wechat,normalized_wechat,status,version,
        acquired_at,reserved_at,released_at,created_at,updated_at,identity_subject_type
      ) VALUES(
        'historical-claim-1','historical-subject-1','Michael_er','michael_er',
        'ACTIVE',1,1000,NULL,NULL,1000,1000,'SELLER_ORG_MEMBER'
      );
      INSERT INTO seller_organizations(
        id,marketplace_code,seller_code,origin_channel_id,current_channel_id,
        seller_sequence,organization_name,status,version,created_at,updated_at,
        activated_at,disabled_at,next_member_number
      ) VALUES(
        'historical-org-1','AMAZON_JP','historical-michael','seller-channel-ido-mango',
        'seller-channel-ido-mango',2000001,'Michael_er','ACTIVE',1,1000,1000,1000,NULL,2
      );
      INSERT INTO seller_organization_members(
        id,identity_subject_id,organization_id,member_number,username_fallback,
        display_name,role,primary_owner,status,version,created_at,updated_at,
        activated_at,disabled_at
      ) VALUES(
        'historical-member-1','historical-subject-1','historical-org-1',1,
        'historical-michael:owner','Michael_er','OWNER',1,'ACTIVE',1,1000,1000,1000,NULL
      );
    `);
    const items = await listHistoricalSellerDirectory(database, ownerActor());
    expect(items.length).toBeGreaterThan(0);
  });

  it('lists a formal seller organization without a portal member yet', async () => {
    database = createMigratedTestDatabase();
    database.exec(`
      INSERT INTO seller_channels (
        id, code, prefix, name, status, version, created_at, updated_at, disabled_at
      ) VALUES ('dir-test-channel','dirtest','dirtest-','目录渠道','ACTIVE',1,1000,1000,NULL);
      INSERT INTO customer_identity_subjects (id, subject_type, created_at)
        VALUES ('dir-test-subject','SELLER_ORG_MEMBER',1000);
      INSERT INTO wechat_identity_claims (
        id, identity_subject_id, display_wechat, normalized_wechat, status,
        version, acquired_at, created_at, updated_at, identity_subject_type
      ) VALUES ('dir-test-claim','dir-test-subject','dir_test_wechat','dir_test_wechat',
        'ACTIVE',1,1000,1000,1000,'SELLER_ORG_MEMBER');
      INSERT INTO seller_organizations (
        id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
        seller_sequence, organization_name, status, version,
        created_at, updated_at, activated_at, next_member_number
      ) VALUES ('dir-test-org','AMAZON_JP','dir-test-org-1','dir-test-channel','dir-test-channel',
        9701,'目录测试组织','ACTIVE',1,1000,1000,1000,2);
      INSERT INTO seller_organization_members (
        id, identity_subject_id, organization_id, member_number, username_fallback,
        display_name, role, primary_owner, status, version,
        created_at, updated_at, activated_at, disabled_at
      ) VALUES ('dir-test-member','dir-test-subject','dir-test-org',1,'dir-test-org-1',
        '目录成员','OWNER',1,'ACTIVE',1,1000,1000,1000,NULL);
    `);
    const items = await listHistoricalSellerDirectory(database, ownerActor());
    expect(items).toContainEqual(
      expect.objectContaining({
        seller_organization_id: 'dir-test-org',
        display_name: '目录测试组织',
        source_status: 'CURRENT_OR_NEW',
        has_portal_account: false,
      }),
    );
  });
});



function ownerActor() {
  return {
    staffId: 'staff-directory-owner',
    displayName: '目录管理员',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(['owner' as const]),
    permissions: new Set(['SELLER_MANAGE' as const]),
  } as never;
}
