import { canonicalJson } from '../serialization/canonical-json';
import { sha256Hex } from '../crypto/sha256';

export async function orderInstructionContentHash(input: {
  reservationId: string;
  productVersionId: string;
  productVersionNo: number;
  productName: string;
  mainImageFileObjectId: string;
  mainImageSha256: string;
  storeDisplayName: string;
  buyerVisibleNotes: string | null;
  staffPublicNote: string | null;
  referenceOrderAmountJpy: number;
  buyerSelfPayBps: number;
  colorSpecMode: 'MAIN_IMAGE_VARIANT' | 'ANY_VARIANT';
  orderedKeywordHmacDigests: readonly string[];
  keywordImageSha256: readonly string[];
  generatorVersion: string;
}): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalJson({
    reservation_id: input.reservationId,
    product_version_id: input.productVersionId,
    product_version_no: input.productVersionNo,
    product_name_snapshot: input.productName,
    main_image_file_object_id: input.mainImageFileObjectId,
    main_image_sha256: input.mainImageSha256,
    store_display_name: input.storeDisplayName,
    buyer_visible_notes: input.buyerVisibleNotes,
    staff_public_note: input.staffPublicNote,
    reference_order_amount_jpy: input.referenceOrderAmountJpy,
    buyer_self_pay_bps: input.buyerSelfPayBps,
    color_spec_mode: input.colorSpecMode,
    ordered_keyword_hmac_digests: [...input.orderedKeywordHmacDigests],
    keyword_image_sha256: [...input.keywordImageSha256],
    generator_version: input.generatorVersion,
  })));
}
