import { describe, expect, it } from 'vitest';
import { staffLogoutAllResponseSchema, staffLogoutResponseSchema } from './staff-logout-schemas';

describe('Staff logout response boundaries', () => {
  it('accepts only the ordinary logout response', () => {
    expect(staffLogoutResponseSchema.safeParse({ logged_out: true, all_devices_logged_out: false }).success).toBe(true);
    expect(staffLogoutResponseSchema.safeParse({ logged_out: true, all_devices_logged_out: true, session_version: 2 }).success).toBe(false);
  });

  it('accepts logout-all session version and rejects ordinary response', () => {
    expect(staffLogoutAllResponseSchema.safeParse({ logged_out: true, all_devices_logged_out: true, session_version: 2 }).success).toBe(true);
    expect(staffLogoutAllResponseSchema.safeParse({ logged_out: true, all_devices_logged_out: false }).success).toBe(false);
  });
});
