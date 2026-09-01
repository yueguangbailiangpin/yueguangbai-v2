import type { SqlDatabase } from '@ygb/contracts';

export interface Phase3GInstructionFixture {
  instructionId: string;
  instructionVersionId: string;
  evidenceFileObjectId: string;
  deadlineAt: number;
}

export async function seedPhase3GInstructionFixture(
  database: SqlDatabase,
  input: {
    suffix: string;
    reservationId: string;
    buyerCustomerId: string;
    productId: string;
    productVersionId: string;
    staffId: string;
    referenceOrderAmountJpy?: number;
    buyerSelfPayBps?: number;
    publishedAt?: number;
    seedEvidenceFile?: boolean;
  },
): Promise<Phase3GInstructionFixture> {
  const instructionId = `phase3g-instruction-${input.suffix}`;
  const instructionVersionId = `phase3g-instruction-version-${input.suffix}`;
  const mainIntentId = `phase3g-main-intent-${input.suffix}`;
  const mainObjectId = `phase3g-main-object-${input.suffix}`;
  const mainLinkId = `phase3g-main-link-${input.suffix}`;
  const evidenceIntentId = `phase3g-evidence-intent-${input.suffix}`;
  const evidenceFileObjectId = `phase3g-evidence-object-${input.suffix}`;
  const publishedAt = input.publishedAt ?? 6_000;
  const deadlineAt = publishedAt + (6 * 60 * 60 * 1_000);
  const referenceOrderAmountJpy = input.referenceOrderAmountJpy ?? 1_980;
  const buyerSelfPayBps = input.buyerSelfPayBps ?? 0;
  const safeSuffix = input.suffix
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .slice(0, 32)
    .padEnd(32, 'x');

  await database.prepare(`
    INSERT INTO order_instructions (
      id, reservation_id, buyer_customer_id, marketplace_code,
      status, current_version_no, version, published_at,
      initial_deadline_at, resubmission_deadline_at,
      expired_at, cancelled_at, completed_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'AMAZON_JP', 'UNPUBLISHED', 0, 1, NULL,
      NULL, NULL, NULL, NULL, NULL, ?, ?)
  `).bind(
    instructionId,
    input.reservationId,
    input.buyerCustomerId,
    publishedAt,
    publishedAt,
  ).run();

  await seedVerifiedFile(database, {
    intentId: mainIntentId,
    objectId: mainObjectId,
    suffix: `main-${safeSuffix}`,
    ownerActorType: 'STAFF',
    ownerActorId: input.staffId,
    purpose: 'PRODUCT_IMAGE',
    visibility: 'BUYER_VISIBLE',
    at: publishedAt - 1_000,
  });
  await database.prepare(`
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (?, ?, 'ORDER_INSTRUCTION_VERSION', ?, 'PRODUCT_IMAGE',
      'BUYER_VISIBLE', 'STAFF', ?, ?, 'EXPLICIT_AUDIENCES', NULL, NULL)
  `).bind(
    mainLinkId,
    mainObjectId,
    instructionVersionId,
    input.staffId,
    publishedAt,
  ).run();
  await database.prepare(`
    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type, buyer_customer_id,
      seller_organization_id, staff_permission_code, staff_scope_type,
      staff_team_id, granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES (?, ?, 'BUYER', ?, NULL, NULL, NULL, NULL,
      'STAFF', ?, ?, NULL, NULL)
  `).bind(
    `phase3g-main-grant-${input.suffix}`,
    mainLinkId,
    input.buyerCustomerId,
    input.staffId,
    publishedAt,
  ).run();
  await database.prepare(`
    INSERT INTO order_instruction_versions (
      id, instruction_id, version_no, reservation_id,
      product_id, product_version_id, product_version_no,
      main_image_file_entity_link_id, store_display_name_snapshot,
      demand_buyer_visible_notes_snapshot, staff_public_note,
      reference_order_amount_jpy, buyer_self_pay_bps,
      estimated_self_pay_jpy, estimated_refundable_principal_jpy,
      color_spec_mode, content_hash, generator_version,
      published_by_staff_id, published_at, initial_deadline_at, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, 1, ?, 'Phase 3G fixture store',
      NULL, NULL, ?, ?, 0, ?, 'MAIN_IMAGE_VARIANT', ?,
      'phase3g-test-v1', ?, ?, ?, ?)
  `).bind(
    instructionVersionId,
    instructionId,
    input.reservationId,
    input.productId,
    input.productVersionId,
    mainLinkId,
    referenceOrderAmountJpy,
    buyerSelfPayBps,
    referenceOrderAmountJpy,
    'c'.repeat(64),
    input.staffId,
    publishedAt,
    deadlineAt,
    publishedAt,
  ).run();
  await database.prepare(`
    UPDATE order_instructions
    SET status='ACTIVE', current_version_no=1, version=2,
        published_at=?, initial_deadline_at=?, updated_at=?
    WHERE id=? AND version=1
  `).bind(
    publishedAt,
    deadlineAt,
    publishedAt + 1,
    instructionId,
  ).run();

  if (input.seedEvidenceFile !== false) {
    await seedVerifiedFile(database, {
      intentId: evidenceIntentId,
      objectId: evidenceFileObjectId,
      suffix: `evidence-${safeSuffix}`,
      ownerActorType: 'BUYER_CUSTOMER',
      ownerActorId: input.buyerCustomerId,
      purpose: 'ORDER_EVIDENCE',
      visibility: 'BUYER_VISIBLE',
      at: publishedAt + 500,
    });
  }

  return {
    instructionId,
    instructionVersionId,
    evidenceFileObjectId,
    deadlineAt,
  };
}

export async function bindPhase3GEvidenceFixture(
  database: SqlDatabase,
  input: {
    suffix: string;
    submissionId: string;
    evidenceVersionId: string;
    reservationId: string;
    buyerCustomerId: string;
    evidenceFileObjectId: string;
    amazonOrderNumber: string;
    createClaim?: boolean;
    at?: number;
  },
): Promise<void> {
  const linkId = `phase3g-evidence-link-${input.suffix}`;
  const at = input.at ?? 7_000;
  await database.prepare(`
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (?, ?, 'ORDER', ?, 'ORDER_EVIDENCE', 'BUYER_VISIBLE',
      'BUYER_CUSTOMER', ?, ?, 'EXPLICIT_AUDIENCES', NULL, NULL)
  `).bind(
    linkId,
    input.evidenceFileObjectId,
    input.evidenceVersionId,
    input.buyerCustomerId,
    at,
  ).run();
  await database.prepare(`
    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type, buyer_customer_id,
      seller_organization_id, staff_permission_code, staff_scope_type,
      staff_team_id, granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES (?, ?, 'BUYER', ?, NULL, NULL, NULL, NULL,
      'BUYER_CUSTOMER', ?, ?, NULL, NULL)
  `).bind(
    `phase3g-evidence-grant-${input.suffix}`,
    linkId,
    input.buyerCustomerId,
    input.buyerCustomerId,
    at,
  ).run();
  await database.prepare(`
    INSERT INTO order_evidence_version_files (
      id, submission_id, version_id, reservation_id,
      buyer_customer_id, file_object_id, file_entity_link_id,
      visibility, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'BUYER_VISIBLE', ?)
  `).bind(
    `phase3g-evidence-binding-${input.suffix}`,
    input.submissionId,
    input.evidenceVersionId,
    input.reservationId,
    input.buyerCustomerId,
    input.evidenceFileObjectId,
    linkId,
    at,
  ).run();
  if (input.createClaim !== false) {
    await database.prepare(`
      INSERT INTO formal_order_number_claims (
        id, marketplace_code, amazon_order_number_normalized,
        evidence_submission_id, current_evidence_version_id,
        formal_order_id, status, version, claimed_at, updated_at,
        finalized_at, released_at
      ) VALUES (?, 'AMAZON_JP', ?, ?, ?, NULL, 'PROVISIONAL', 1, ?, ?, NULL, NULL)
    `).bind(
      `phase3g-order-claim-${input.suffix}`,
      input.amazonOrderNumber,
      input.submissionId,
      input.evidenceVersionId,
      at,
      at,
    ).run();
  }
}

async function seedVerifiedFile(
  database: SqlDatabase,
  input: {
    intentId: string;
    objectId: string;
    suffix: string;
    ownerActorType: 'STAFF' | 'BUYER_CUSTOMER';
    ownerActorId: string;
    purpose: 'PRODUCT_IMAGE' | 'ORDER_EVIDENCE';
    visibility: 'BUYER_VISIBLE';
    at: number;
  },
): Promise<void> {
  await database.prepare(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility, status,
      requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, 'ISSUED', 1, ?, 1, ?, NULL, ?, ?, NULL)
  `).bind(
    input.intentId,
    input.ownerActorType,
    input.ownerActorId,
    input.purpose,
    input.visibility,
    'a'.repeat(64),
    input.at + 10_000_000,
    input.at,
    input.at,
  ).run();
  await database.prepare(`
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (?, ?, 1, ?, ?, ?, 'fixture.png', 'png', 'image/png', 8,
      'RESERVED', ?, ?, NULL, NULL, NULL, NULL, 0, NULL, 1, ?, ?,
      NULL, NULL, NULL)
  `).bind(
    input.objectId,
    input.intentId,
    input.purpose,
    input.visibility,
    `files/v1/2026/08/phase3g-${input.suffix.padEnd(40, 'x')}`,
    'b'.repeat(64),
    input.at + 10_000_000,
    input.at,
    input.at,
  ).run();
  await database.prepare(`
    UPDATE file_upload_intents
    SET status='VERIFIED', version=2, updated_at=?, completed_at=?
    WHERE id=?
  `).bind(input.at + 1, input.at + 1, input.intentId).run();
  await database.prepare(`
    UPDATE file_objects
    SET status='VERIFIED', version=2, uploaded_byte_size=8,
        detected_mime='image/png', uploaded_sha256=?, updated_at=?,
        uploaded_at=?, verified_at=?
    WHERE id=?
  `).bind(
    'd'.repeat(64),
    input.at + 1,
    input.at + 1,
    input.at + 1,
    input.objectId,
  ).run();
}
