import type { ApiErrorCode } from '@ygb/contracts';

export type AcquisitionErrorCode = ApiErrorCode
  | 'CHANNEL_CONFIGURATION_MISSING'
  | 'CHANNEL_CONFIGURATION_AMBIGUOUS'
  | 'DUPLICATE_LEAD';

export class AcquisitionError extends Error {
  constructor(
    public readonly code: AcquisitionErrorCode,
    public readonly status: 400|401|403|404|409|503,
  ) {
    super(code);
    this.name = 'AcquisitionError';
  }
}

export function validation(): never {
  throw new AcquisitionError('VALIDATION_ERROR', 400);
}
