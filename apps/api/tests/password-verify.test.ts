import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.service.js';

/**
 * Regression guard for a bug that hid for weeks.
 *
 * `verifyPassword` wrapped the whole argon2 call in `catch { return false }`.
 * That is right for a stored value that is not a hash, and wrong for everything
 * else: argon2 allocates 19 MiB per verification, and when an allocation failed
 * the user was told their password was incorrect. The symptom was a 401 on a
 * correct password roughly one suite run in nine, and it resisted diagnosis
 * because the failure had been converted into a plausible answer.
 *
 * The distinction now: input that is not an argon2 hash reads as a wrong
 * password; an argon2 failure is allowed to throw.
 */

const PASSWORD = 'thicket-marmalade-99-vault';

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword('not-the-password', stored)).toBe(false);
  });

  // These all make argon2 itself throw. The prefix guard answers them before it
  // is ever called, which is the security property being preserved: an
  // unusual stored value must be indistinguishable from a wrong password, not
  // an error that tells an attacker this account's record is different.
  it.each([
    ['an empty string', ''],
    ['a bcrypt hash from another system', '$2b$12$abcdefghijklmnopqrstuv'],
    ['a truncated column', '$argon'],
    ['plaintext left in the column by a bad migration', PASSWORD],
  ])('reads %s as a wrong password rather than crashing', async (_label, stored) => {
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
  });

  it('reads a well-formed but undecodable argon2 hash as a wrong password', async () => {
    // argon2 returns false rather than throwing for this shape — verified
    // against the library rather than assumed.
    await expect(
      verifyPassword(PASSWORD, '$argon2id$v=19$m=19456,t=2,p=1$not-valid'),
    ).resolves.toBe(false);
  });

  it('surfaces a corrupt argon2 record instead of silently denying access', async () => {
    // An unknown argon2 variant clears the prefix guard and makes the library
    // throw. That is deliberate. We only ever write argon2id, so this record
    // cannot occur through any normal path — and the old blanket catch would
    // have turned it into "wrong password" forever, locking a user out of their
    // account with no signal anywhere that anything was broken.
    await expect(
      verifyPassword(PASSWORD, '$argon2xx$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaA'),
    ).rejects.toThrow(/invalid hashed password/i);
  });

  it('produces a different hash for the same password each time', async () => {
    // Salted. Two identical passwords hashing identically would mean a database
    // dump reveals which users share one.
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(PASSWORD, b)).toBe(true);
  });
});
