import { describe, expect, it } from 'vitest';
import {
  dateOnlySchema,
  demandSchema,
  evidenceFileSchema,
  identifierSchema,
  integerAmountSchema,
  instructionResponseSchema,
  orderEvidenceSchema,
  reviewDetailValueSchema,
} from './runtime';

describe('Module 1 buyer strict runtime contracts', () => {
  it.each(['2024-02-29', '2026-08-06'])('accepts Gregorian date-only %s', (value) => {
    expect(dateOnlySchema.parse(value)).toBe(value);
  });

  it.each(['2023-02-29', '2024-02-30', '2024-00-01', '2024-13-01', '2024-01-00', ' 2024-01-01', '2024-01-01T00:00:00Z', '２０２４-０１-０１'])(
    'rejects malformed or non-Gregorian date %s',
    (value) => expect(dateOnlySchema.safeParse(value).success).toBe(false),
  );

  it('keeps financial integer strings out of floating point', () => {
    expect(integerAmountSchema.parse('900719925474099312345')).toBe('900719925474099312345');
    expect(integerAmountSchema.safeParse('1.25').success).toBe(false);
  });

  it('accepts only a protected product-image reference without an object address', () => {
    const demand = buyerDemand();
    expect(demandSchema.parse(demand).main_image).toEqual({
      file_object_id: 'product-main-image-1',
      file_version: 3,
      purpose: 'PRODUCT_IMAGE',
      visibility: 'SELLER_VISIBLE',
    });
    expect(demandSchema.safeParse({
      ...demand,
      main_image: { ...demand.main_image, object_key: 'files/v1/private' },
    }).success).toBe(false);
  });

  it('accepts exactly the readable evidence file authority tuple', () => {
    expect(evidenceFileSchema.parse({
      file_object_id: 'file-1', client_file_name: 'a.png', mime: 'image/png', byte_size: 2,
      status: 'VERIFIED', visibility: 'BUYER_VISIBLE', verified_at: 1,
      file_entity_link_id: 'link-1', version: 3, allowed_actions: ['CREATE_READ_INTENT'],
    })).toMatchObject({ version: 3 });
  });

  it('accepts historical metadata only without link, version, or action', () => {
    expect(evidenceFileSchema.parse({
      file_object_id: 'file-1', client_file_name: 'a.png', mime: 'image/png', byte_size: 2,
      status: 'VERIFIED', visibility: 'BUYER_VISIBLE', verified_at: 1,
      file_entity_link_id: null, version: null, allowed_actions: [],
    })).toMatchObject({ file_entity_link_id: null });
  });

  it.each([
    { file_entity_link_id: null, version: 1, allowed_actions: [] },
    { file_entity_link_id: 'link-1', version: null, allowed_actions: ['CREATE_READ_INTENT'] },
    { file_entity_link_id: 'link-1', version: 0, allowed_actions: ['CREATE_READ_INTENT'] },
  ])('rejects incoherent evidence file authority %#', (authority) => {
    expect(evidenceFileSchema.safeParse({
      file_object_id: 'file-1', client_file_name: 'a.png', mime: 'image/png', byte_size: 2,
      status: 'VERIFIED', visibility: 'BUYER_VISIBLE', verified_at: 1, ...authority,
    }).success).toBe(false);
  });

  it('rejects extra DTO fields recursively', () => {
    expect(identifierSchema.safeParse('safe-id').success).toBe(true);
    expect(reviewDetailValueSchema.safeParse({ surprise: true }).success).toBe(false);
  });

  it('accepts content only for ACTIVE instructions with strict main and increasing keyword image paths', () => {
    const content = instruction('ACTIVE');
    expect(instructionResponseSchema.safeParse({ order_instruction: content }).success).toBe(true);
    expect(instructionResponseSchema.safeParse({ order_instruction: instruction('COMPLETED') }).success).toBe(false);
    expect(instructionResponseSchema.safeParse({ order_instruction: {
      ...content, main_image: { ...content.main_image, position: 1 },
    } }).success).toBe(false);
    expect(instructionResponseSchema.safeParse({ order_instruction: {
      ...content, search_keywords: [],
    } }).success).toBe(false);
    expect(instructionResponseSchema.safeParse({ order_instruction: {
      ...content, keyword_images: [
        { ...content.keyword_images[0]!, position: 2, read_intent_path: content.keyword_images[0]!.read_intent_path.replace('/1/', '/2/') },
        { ...content.keyword_images[0]!, image_id: 'keyword-2' },
      ],
    } }).success).toBe(false);
  });

  it.each([[false, 0, true], [true, 512, true], [true, -512, true], [false, 1, false], [true, 0, false]] as const)(
    'enforces price mismatch %s against signed difference %i',
    (priceMismatch, difference, valid) => {
      expect(orderEvidenceSchema.safeParse({ ...evidence(), price_mismatch: priceMismatch, price_difference_jpy: difference }).success).toBe(valid);
    },
  );
});

function instruction(status: string) {
  const prefix = '/api/buyer-portal/reservations/r1/order-instruction/images';
  return {
    status, instruction_version: 1, current_version_no: 1,
    evidence_status: 'NOT_SUBMITTED', can_submit_evidence: status === 'ACTIVE', can_read_images: status === 'ACTIVE',
    product_name: '月光白', store_display_name: '店铺',
    search_keywords: ['月光白', '商品关键词'], color_spec_mode: 'MAIN_IMAGE_VARIANT',
    staff_public_note: null, buyer_visible_notes: null, initial_deadline_at: 1, resubmission_deadline_at: null,
    content_updated: false, reference_order_amount_jpy: '1200', buyer_self_pay_bps: 1000,
    estimated_buyer_self_pay_jpy: '120', estimated_refundable_principal_jpy: '1080',
    main_image: { image_id: 'main', position: null, mime: 'image/png', width: 100, height: 100,
      read_intent_path: `${prefix}/main/read-intent` },
    keyword_images: [{ image_id: 'keyword-1', position: 1, mime: 'image/jpeg', width: null, height: null,
      read_intent_path: `${prefix}/1/read-intent` }],
  };
}

function buyerDemand() {
  return {
    demand_id: 'd1', demand_version: 1, marketplace_code: 'JP',
    product_name: '月光白', main_image: {
      file_object_id: 'product-main-image-1', file_version: 3,
      purpose: 'PRODUCT_IMAGE', visibility: 'SELLER_VISIBLE',
    },
    reference_order_amount_jpy: '1200', buyer_self_pay_bps: 0,
    estimated_buyer_self_pay_jpy: '0', estimated_refundable_principal_jpy: '1200',
    buyer_visible_notes: null, store_display_name: '店铺', task_type: 'TEXT',
    target_quantity: 3, remaining_quantity: 2, open_at: 1,
    reservation_deadline: 2, order_deadline: 3,
    reservation_eligibility: 'ELIGIBLE', reservation_ineligibility_reason: null,
  };
}

function evidence() {
  return {
    submission_id: 'e1', reservation: { reservation_id: 'r1', demand_id: 'd1', marketplace_code: 'JP',
      product_name: '月光白', store_display_name: '店铺', review_type: 'IMAGE', order_deadline: 1 },
    marketplace: 'JP', amazon_order_number_display: '123-1234567-1234567', amazon_order_date: '2026-08-06',
    final_paid_jpy: 1200, buyer_self_pay_bps: 1000, buyer_self_pay_jpy: 120,
    buyer_refundable_principal_jpy: 1080, price_mismatch: false, price_difference_jpy: 0,
    status: 'PENDING_VERIFICATION', version: 1, evidence_version_no: 1, submitted_at: 1, updated_at: 1,
    verified_at: null, public_change_reason: null, files: [], allowed_actions: ['WITHDRAW'],
  };
}
