import type {
  SellerMemberRole,
  SqlDatabase,
} from '@ygb/contracts';

interface SellerMemberAccessRow {
  member_id: string;
  organization_id: string;
  member_role: SellerMemberRole;
  member_status: string;
  organization_status: string;
}

interface StoreIdRow {
  store_id: string;
}

export interface SellerMemberStoreAccess {
  memberId: string;
  sellerOrganizationId: string;
  role: SellerMemberRole;
  allActiveStores: boolean;
  storeIds: readonly string[];
  canManageProducts: boolean;
}

export async function resolveSellerMemberStoreAccess(
  database: SqlDatabase,
  memberId: string,
): Promise<SellerMemberStoreAccess | null> {
  const member = await database.prepare(`
    SELECT
      member.id AS member_id,
      member.organization_id,
      member.role AS member_role,
      member.status AS member_status,
      organization.status AS organization_status
    FROM seller_organization_members member
    JOIN seller_organizations organization
      ON organization.id=member.organization_id
    WHERE member.id=?
  `).bind(memberId).first<SellerMemberAccessRow>();

  if (!member
    || member.member_status !== 'ACTIVE'
    || member.organization_status !== 'ACTIVE') {
    return null;
  }

  const allActiveStores = member.member_role === 'OWNER';
  const stores = allActiveStores
    ? await database.prepare(`
        SELECT id AS store_id
        FROM seller_stores
        WHERE organization_id=?
          AND status='ACTIVE'
        ORDER BY id
      `).bind(
        member.organization_id,
      ).all<StoreIdRow>()
    : await database.prepare(`
        SELECT scope.store_id
        FROM seller_member_store_scopes scope
        JOIN seller_stores store
          ON store.id=scope.store_id
          AND store.organization_id=scope.organization_id
        WHERE scope.member_id=?
          AND scope.organization_id=?
          AND scope.status='ACTIVE'
          AND store.status='ACTIVE'
        ORDER BY scope.store_id
      `).bind(
        member.member_id,
        member.organization_id,
      ).all<StoreIdRow>();

  return Object.freeze({
    memberId: member.member_id,
    sellerOrganizationId: member.organization_id,
    role: member.member_role,
    allActiveStores,
    storeIds: Object.freeze(
      stores.results.map((row) => row.store_id),
    ),
    canManageProducts:
      member.member_role === 'OWNER'
      || member.member_role === 'OPERATIONS',
  });
}
