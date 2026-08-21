import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { listHistoricalSellerDirectory } from './historical-seller-directory';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

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
        'historical-org-1','JP','historical-michael','seller-channel-ido-mango',
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
      INSERT INTO acquisition_historical_source_exemptions(
        id,subject_type,subject_id,marketplace_code,reason,declared_at,declared_by_staff_id
      ) VALUES(
        'historical-exemption-1','SELLER_ORGANIZATION','historical-org-1','AMAZON_JP',
        'TENCENT_FROZEN_DIRECTORY_2026_08_17;SOURCE_FILES=3',1000,'zz-phase3h-test-owner'
      );
    `);
    const items = await listHistoricalSellerDirectory(database, owner());
    expect(items).toContainEqual(expect.objectContaining({
      seller_organization_id: 'historical-org-1',
      display_name: 'Michael_er',
      wechat_masked: 'Mi***er',
      source_status: 'HISTORICAL_FROZEN_IMPORT',
      source_file_count: 3,
      has_portal_account: false,
    }));
    const leadCount = database.raw.prepare(`SELECT COUNT(*) AS count FROM acquisition_leads`).get() as { count: number };
    expect(leadCount.count).toBe(0);
  });
});

function owner(): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set(['owner']), grants: new Set(), denies: new Set(),
    memberTeamIds: [], leaderTeamIds: [],
  });
  return {
    staffId: 'zz-phase3h-test-owner', displayName: 'Owner', staffStatus: 'ACTIVE',
    authorizationVersion: 1, ...effective,
  };
}
