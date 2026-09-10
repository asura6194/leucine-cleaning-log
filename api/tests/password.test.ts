import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

describe('password hashing', () => {
  it('accepts the correct password and rejects a wrong one', async () => {
    const stored = await hashPassword('password123');

    // Self-describing format, so cost parameters can be raised later without
    // invalidating hashes that already exist.
    expect(stored.startsWith('scrypt$')).toBe(true);

    await expect(verifyPassword('password123', stored)).resolves.toBe(true);
    await expect(verifyPassword('password124', stored)).resolves.toBe(false);
  });

  it('uses a random salt, so the same password hashes differently each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects a malformed stored hash rather than throwing', async () => {
    for (const bad of ['', 'not-a-hash', 'scrypt$1$2$3', 'bcrypt$16384$8$1$c2FsdA==$aGFzaA==']) {
      await expect(verifyPassword('password123', bad)).resolves.toBe(false);
    }
  });
});
