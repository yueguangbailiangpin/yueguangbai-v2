export function evaluateWorkerRollback(input: {
  deletedR2Objects: number;
  targetSupportsDriveProxy: boolean;
  manifestVerifiedRehydratedObjects: number;
}): { allowed: boolean; reason: string } {
  for (const value of [input.deletedR2Objects, input.manifestVerifiedRehydratedObjects]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_rollback_count');
  }
  if (input.deletedR2Objects === 0 || input.targetSupportsDriveProxy) {
    return { allowed: true, reason: 'COMPATIBLE_WORKER_ROLLBACK' };
  }
  if (input.manifestVerifiedRehydratedObjects === input.deletedR2Objects) {
    return { allowed: true, reason: 'MANIFEST_VERIFIED_REHYDRATION_COMPLETE' };
  }
  return { allowed: false, reason: 'R2_REHYDRATION_REQUIRED' };
}
