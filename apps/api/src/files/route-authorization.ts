import type {
  FileActor,
  FilePurpose,
  FileReadPrincipal,
  FileVisibility,
  StaffDataScope,
  StaffPermissionCode,
  SqlDatabase,
} from '@ygb/contracts';
import {
  scopeAllowsBuyer,
  scopeAllowsSellerOrganization,
  type AssignmentStaffAuthorization,
} from '../staff-assignment';
import type {
  FileAuthorizationResource,
  FileAuthorizationService,
} from './authorization';
import { FileStorageError } from './file-error';

export class RouteBoundFileAuthorizationService
implements FileAuthorizationService {
  constructor(
    private readonly database: SqlDatabase,
    private readonly actor: FileActor,
    private readonly allowedUploads: ReadonlyMap<FilePurpose, FileVisibility>,
    private readonly principal?: FileReadPrincipal,
    private readonly staffAuthorization?: AssignmentStaffAuthorization,
    private readonly staffDataScope?: StaffDataScope,
  ) {}

  assertCanCreateUpload(
    actor: FileActor,
    input: { purpose: FilePurpose; visibility: FileVisibility },
  ): void {
    this.assertActor(actor);
    if (this.allowedUploads.get(input.purpose) !== input.visibility) deny();
    this.assertStaffUploadPermission(input.purpose);
  }

  assertCanUpload(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): void {
    this.assertOwnedUpload(actor, resource);
  }

  assertCanCompleteUpload(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): void {
    this.assertOwnedUpload(actor, resource);
  }

  assertCanLink(): never {
    // Entity-aware application commands own all Link/Grant creation.
    deny();
  }

  async assertCanRead(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): Promise<void> {
    this.assertActor(actor);
    if (resource.linkRevokedAt !== null
      || (resource.linkExpiresAt !== null
        && resource.linkExpiresAt <= Date.now())) {
      deny();
    }
    if (resource.ownerActorType === actor.type
      && resource.ownerActorId === actor.id) {
      return;
    }
    if (actor.type !== 'STAFF'
      || !this.staffAuthorization
      || !this.staffDataScope
      || this.principal?.type !== 'STAFF_SESSION'
      || this.principal.staffId !== actor.id) {
      deny();
    }
    const permission = readPermissionForPurpose(resource.purpose);
    if (!this.staffAuthorization.permissions.has(permission)) deny();
    await this.assertStaffEntityScope(resource);
  }

  private assertActor(actor: FileActor): void {
    if (actor.type !== this.actor.type || actor.id !== this.actor.id) deny();
  }

  private assertOwnedUpload(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): void {
    this.assertActor(actor);
    if (resource.ownerActorType !== actor.type
      || resource.ownerActorId !== actor.id
      || this.allowedUploads.get(resource.purpose) !== resource.visibility) {
      deny();
    }
    this.assertStaffUploadPermission(resource.purpose);
  }

  private assertStaffUploadPermission(purpose: FilePurpose): void {
    if (this.actor.type !== 'STAFF') return;
    const permission = readWritePermissionForPurpose(purpose);
    if (!this.staffAuthorization?.permissions.has(permission)) deny();
  }

  private async assertStaffEntityScope(
    resource: FileAuthorizationResource,
  ): Promise<void> {
    if (!resource.entityType || !resource.entityId || !this.staffDataScope) {
      deny();
    }
    if (this.staffDataScope.type === 'GLOBAL') return;
    const authority = await resolveEntityAuthority(
      this.database,
      resource.entityType,
      resource.entityId,
    );
    if (authority.buyerCustomerId
      && scopeAllowsBuyer(this.staffDataScope, authority.buyerCustomerId)) {
      return;
    }
    if (authority.sellerOrganizationId
      && scopeAllowsSellerOrganization(
        this.staffDataScope,
        authority.sellerOrganizationId,
      )) {
      return;
    }
    deny();
  }
}

function readPermissionForPurpose(purpose: FilePurpose): StaffPermissionCode {
  switch (purpose) {
    case 'ORDER_EVIDENCE':
    case 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION':
    case 'ORDER_INSTRUCTION_KEYWORD_IMAGE':
      return 'ORDER_VIEW';
    case 'REVIEW_EVIDENCE': return 'REVIEW_VIEW';
    case 'PRODUCT_APPLICATION_IMAGE':
    case 'PRODUCT_IMAGE': return 'PRODUCT_VIEW';
    case 'BUYER_REFUND_PROOF': return 'BUYER_REFUND_VIEW';
    case 'SELLER_SETTLEMENT_PROOF': return 'SELLER_SETTLEMENT_VIEW';
    default: return 'AUDIT_VIEW';
  }
}

function readWritePermissionForPurpose(
  purpose: FilePurpose,
): StaffPermissionCode {
  switch (purpose) {
    case 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION': return 'ORDER_CONFIRM';
    case 'BUYER_REFUND_PROOF': return 'BUYER_REFUND_RECORD';
    case 'SELLER_SETTLEMENT_PROOF': return 'SELLER_SETTLEMENT_RECORD';
    default: return readPermissionForPurpose(purpose);
  }
}

async function resolveEntityAuthority(
  database: SqlDatabase,
  entityType: string,
  entityId: string,
): Promise<{
  buyerCustomerId: string | null;
  sellerOrganizationId: string | null;
}> {
  switch (entityType) {
    case 'ORDER_EVIDENCE_SUBMISSION': {
      const row = await database.prepare(`
        SELECT submission.buyer_customer_id,
          reservation.organization_id AS seller_organization_id
        FROM order_evidence_submissions submission
        JOIN product_reservations reservation
          ON reservation.id=submission.reservation_id
        WHERE submission.id=?
      `).bind(entityId).first<{
        buyer_customer_id: string;
        seller_organization_id: string;
      }>();
      return authority(row);
    }
    case 'ORDER': {
      const row = await database.prepare(`
        SELECT buyer_customer_id, seller_organization_id
        FROM formal_orders WHERE id=?
      `).bind(entityId).first<{
        buyer_customer_id: string;
        seller_organization_id: string;
      }>();
      return authority(row);
    }
    case 'ORDER_INSTRUCTION_VERSION': {
      const row = await database.prepare(`
        SELECT instruction.buyer_customer_id,
          reservation.organization_id AS seller_organization_id
        FROM order_instruction_versions version
        JOIN order_instructions instruction
          ON instruction.id=version.instruction_id
        JOIN product_reservations reservation
          ON reservation.id=instruction.reservation_id
        WHERE version.id=?
      `).bind(entityId).first<{
        buyer_customer_id: string;
        seller_organization_id: string;
      }>();
      return authority(row);
    }
    case 'REVIEW': {
      const row = await database.prepare(`
        SELECT review.buyer_customer_id,
          formal_order.seller_organization_id
        FROM review_cases review
        JOIN formal_orders formal_order
          ON formal_order.id=review.formal_order_id
        WHERE review.id=?
      `).bind(entityId).first<{
        buyer_customer_id: string;
        seller_organization_id: string;
      }>();
      return authority(row);
    }
    case 'BUYER_REFUND': {
      const row = await database.prepare(`
        SELECT obligation.buyer_customer_id,
          formal_order.seller_organization_id
        FROM buyer_refund_obligations obligation
        JOIN formal_orders formal_order
          ON formal_order.id=obligation.formal_order_id
        WHERE obligation.id=?
      `).bind(entityId).first<{
        buyer_customer_id: string;
        seller_organization_id: string;
      }>();
      return authority(row);
    }
    case 'SELLER_SETTLEMENT': {
      const row = await database.prepare(`
        SELECT NULL AS buyer_customer_id, seller_organization_id
        FROM seller_settlement_payments WHERE id=?
      `).bind(entityId).first<{
        buyer_customer_id: null;
        seller_organization_id: string;
      }>();
      return authority(row);
    }
    case 'PRODUCT_APPLICATION': {
      const row = await database.prepare(`
        SELECT NULL AS buyer_customer_id, seller_organization_id
        FROM product_applications WHERE id=?
      `).bind(entityId).first<{
        buyer_customer_id: null;
        seller_organization_id: string;
      }>();
      return authority(row);
    }
    default:
      return { buyerCustomerId: null, sellerOrganizationId: null };
  }
}

function authority(row: {
  buyer_customer_id: string | null;
  seller_organization_id: string | null;
} | null): {
  buyerCustomerId: string | null;
  sellerOrganizationId: string | null;
} {
  return {
    buyerCustomerId: row?.buyer_customer_id ?? null,
    sellerOrganizationId: row?.seller_organization_id ?? null,
  };
}

function deny(): never {
  throw new FileStorageError('FORBIDDEN', 403);
}
