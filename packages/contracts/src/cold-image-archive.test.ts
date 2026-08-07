import { describe,expect,it } from 'vitest';
import { COLD_ARCHIVE_PURPOSES,isColdArchivePurpose,parseSafeFileArchiveStatusDto } from './cold-image-archive';

describe('cold image archive public contract',()=>{
  it('publishes exactly the four frozen evidence purposes',()=>{
    expect(COLD_ARCHIVE_PURPOSES).toEqual([
      'ORDER_EVIDENCE','REVIEW_EVIDENCE','BUYER_REFUND_PROOF','SELLER_SETTLEMENT_PROOF',
    ]);
    expect(COLD_ARCHIVE_PURPOSES.every(isColdArchivePurpose)).toBe(true);
    expect(isColdArchivePurpose('PRODUCT_IMAGE')).toBe(false);
    expect(isColdArchivePurpose('SUPPORT_ATTACHMENT')).toBe(false);
  });
  it('accepts only identifier-free safe DTOs',()=>{
    expect(parseSafeFileArchiveStatusDto({storage_state:'ARCHIVED',archived_at:123,
      time_basis:'UTC_MS',display_timezone:'Asia/Shanghai'})).toEqual({storage_state:'ARCHIVED',
      archived_at:123,time_basis:'UTC_MS',display_timezone:'Asia/Shanghai'});
    expect(()=>parseSafeFileArchiveStatusDto({storage_state:'ARCHIVED',archived_at:123,
      time_basis:'UTC_MS',display_timezone:'Asia/Shanghai',drive_file_id:'secret'})).toThrow();
  });
});
