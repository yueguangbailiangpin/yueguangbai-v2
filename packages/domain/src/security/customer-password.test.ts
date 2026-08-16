import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_PASSWORD_DEFAULT_ITERATIONS,
  generateTemporaryPassword,
  hashCustomerPassword,
  validateCustomerPassword,
  verifyCustomerPassword,
  type PasswordCredential,
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
    // Hard-coded platform bound so a constant regression cannot pass by
    // self-reference: workerd caps PBKDF2 at 100,000.
    expect(CUSTOMER_PASSWORD_DEFAULT_ITERATIONS).toBe(100_000);
  });

  it('rejects hashing with iterations above the workerd platform cap', async () => {
    await expect(hashCustomerPassword('Correct-Horse-2026!', {
      iterations: 100_001,
      salt: new Uint8Array(16).fill(5),
    })).rejects.toThrow('invalid_password_iterations');
  });

  it('fails closed for stored credentials above the platform cap', async () => {
    const credential: PasswordCredential = {
      algorithm: 'PBKDF2_SHA256',
      iterations: 100_001,
      saltBase64Url: 'c2FsdDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MA',
      hashBase64Url: 'aGFzaDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Ng',
    };
    await expect(verifyCustomerPassword(
      'Correct-Horse-2026!',
      credential,
    )).resolves.toBe(false);
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
