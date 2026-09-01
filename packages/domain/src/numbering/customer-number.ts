export class CustomerNumberError extends Error {
  constructor(
    public readonly reason:
      | 'invalid_business_date'
      | 'invalid_channel_code'
      | 'invalid_sequence'
      | 'invalid_seller_prefix',
  ) {
    super(reason);
    this.name = 'CustomerNumberError';
  }
}

export function formatBuyerCustomerNumber(input: {
  businessDate: string;
  channelCode: string;
  sequence: number;
}): string {
  const compactDate = validateBusinessDate(input.businessDate);
  const channelCode = input.channelCode.normalize('NFKC').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/u.test(channelCode)) {
    throw new CustomerNumberError('invalid_channel_code');
  }
  validateSequence(input.sequence);

  // T9-DEFECT-001 fix: pad to 4 digits so the first buyer on a fresh
  // database (sequence=1) produces a 13-char number that satisfies the
  // CHECK(length BETWEEN 13 AND 20) constraint. Without padding, "B1"
  // yields a 10-char number and the INSERT fails with a CHECK violation
  // that surfaces as a 503.
  return `${compactDate}${channelCode}${String(input.sequence).padStart(4, '0')}`;
}

export function formatSellerCustomerCode(input: {
  prefix: string;
  sequence: number;
}): string {
  const prefix = input.prefix.normalize('NFKC').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(prefix)
    || prefix.length > 60) {
    throw new CustomerNumberError('invalid_seller_prefix');
  }
  validateSequence(input.sequence);
  return `${prefix}-${input.sequence}`;
}

function validateBusinessDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new CustomerNumberError('invalid_business_date');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new CustomerNumberError('invalid_business_date');
  }

  return `${match[1]}${match[2]}${match[3]}`;
}

function validateSequence(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CustomerNumberError('invalid_sequence');
  }
}
