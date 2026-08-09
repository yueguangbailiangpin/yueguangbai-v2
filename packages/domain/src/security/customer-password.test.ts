import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_PASSWORD_DEFAULT_ITERATIONS,
  generateTemporaryPassword,
  hashCustomerPassword,
  validateCustomerPassword,
  verifyCustomerPassword,
} from './customer-password';

describe('customer password security', () => {
  it('hashes and verifies PBKDF2 credentials', async () => {
    const credential = await hashCustomerPassword(
      'Correct-Horse-2026!',
      {
        iterations: 10_000,
        salt: new Uint8Array(16).fill(7),
      },
    );

    expect(credential).toMatchObject({
      algorithm: 'PBKDF2_SHA256',
      iterations: 10_000,
    });
    await expect(verifyCustomerPassword(
      'Correct-Horse-2026!',
      credential,
    )).resolves.toBe(true);
    await expect(verifyCustomerPassword(
      'Wrong-Password-2026!',
      credential,
    )).resolves.toBe(false);
  });

  it('uses the single current work factor when no test override is supplied', async () => {
    const credential = await hashCustomerPassword('Correct-Horse-2026!', {
      salt: new Uint8Array(16).fill(9),
    });
    expect(credential.iterations).toBe(CUSTOMER_PASSWORD_DEFAULT_ITERATIONS);
  });

  it('generates a valid temporary password without ambiguous characters', () => {
    const password = generateTemporaryPassword();
    expect(password).toHaveLength(20);
    expect(password).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%]+$/u,
    );
    expect(() => validateCustomerPassword(password)).not.toThrow();
  });

  it('rejects short, control-containing, and oversized passwords', () => {
    expect(() => validateCustomerPassword('short'))
      .toThrow('invalid_customer_password');
    expect(() => validateCustomerPassword('valid-length\nbad'))
      .toThrow('invalid_customer_password');
    expect(() => validateCustomerPassword('x'.repeat(129)))
      .toThrow('invalid_customer_password');
  });
});
