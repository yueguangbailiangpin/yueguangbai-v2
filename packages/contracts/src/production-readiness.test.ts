import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_RELEASE_GATES,
  PRODUCTION_ALERT_CONTROLS,
  validateProductionAlertControls,
} from './production-readiness';

describe('production readiness contracts', () => {
  it('covers every required signal with an independent escalation contract', () => {
    expect(() => validateProductionAlertControls(PRODUCTION_ALERT_CONTROLS))
      .not.toThrow();
    expect(PRODUCTION_ALERT_CONTROLS).toHaveLength(10);
    expect(PRODUCTION_ALERT_CONTROLS.every((control) =>
      control.escalation === 'PROVIDER_INDEPENDENT_REQUIRED')).toBe(true);
  });

  it('keeps every external release action as an explicit owner gate', () => {
    expect(EXTERNAL_RELEASE_GATES).toHaveLength(8);
    expect(EXTERNAL_RELEASE_GATES).toContain('FINAL_PRODUCTION_GO');
    expect(EXTERNAL_RELEASE_GATES).toContain(
      'CHINA_MOBILE_UNICOM_TELECOM_AND_WECHAT_BROWSER_MATRIX',
    );
  });
});
