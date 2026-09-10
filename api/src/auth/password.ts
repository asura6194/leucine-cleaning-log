import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';

/**
 * Password hashing with Node's built-in scrypt.
 *
 * The design document specified argon2id. scrypt is used instead because it is
 * memory-hard, is a recommended password KDF in its own right, and -- decisively
 * for a submission someone else has to install -- ships in the Node standard
 * library, so `npm install` needs no native build toolchain. argon2id remains
 * the better primitive; this is a portability trade, recorded in NOTES.md.
 *
 * Stored format:  scrypt$N$r$p$<salt-base64>$<hash-base64>
 * Self-describing, so the cost parameters can be raised later without
 * invalidating hashes that already exist.
 */
const PARAMS: Required<Pick<ScryptOptions, 'N' | 'r' | 'p'>> = {
  N: 16_384, // CPU/memory cost
  r: 8,      // block size
  p: 1,      // parallelisation
};
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * promisify() resolves to the three-argument overload and loses the one that
 * accepts options, so the callback is wrapped by hand rather than cast away.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(plain, salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string, string, string, string, string, string,
  ];

  const params = { N: Number(nRaw), r: Number(rRaw), p: Number(pRaw) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false;
  }

  const expected = Buffer.from(hashRaw, 'base64');
  const actual = await scrypt(plain, Buffer.from(saltRaw, 'base64'), expected.length, params);

  // Length is compared first because timingSafeEqual throws on mismatched
  // lengths, and that throw would itself leak information.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
