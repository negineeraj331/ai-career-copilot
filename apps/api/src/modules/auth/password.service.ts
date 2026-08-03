import { hash, verify } from '@node-rs/argon2';
import { COMMON_PASSWORDS } from './common-passwords.js';

/**
 * Password hashing and strength (docs/12 §2.1).
 *
 * argon2id at the OWASP minimum. Memory-hard, which is the property that
 * actually degrades GPU cracking — the reason this is argon2id and not the
 * bcrypt the original brief named.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  // A stored value that is not an argon2 hash at all — a legacy record, a
  // truncated column, a placeholder — must read as "wrong password" rather than
  // crash, or the error itself tells an attacker which accounts have unusual
  // records.
  if (!hashed.startsWith('$argon2')) return false;

  // Everything else is allowed to throw, deliberately.
  //
  // This used to be a bare `catch { return false }` around the whole call, and
  // that swallowed operational failures as well as malformed input: argon2
  // allocates 19 MiB per verification, and when that allocation fails the user
  // was told their password was wrong. It presented as an intermittent 401 on a
  // correct password — one run in nine of the test suite — and it was
  // undiagnosable precisely because the cause had been converted into a
  // plausible-looking answer. A 500 here is far better than a lie.
  return verify(hashed, plain, ARGON2_OPTIONS);
}

/**
 * A dummy verification for the login path.
 *
 * Without it, a request for a non-existent email returns in ~1 ms while a real
 * one takes ~50 ms of argon2 work — a timing oracle that enumerates accounts
 * regardless of how carefully the response bodies are matched.
 */
let dummyHash: Promise<string> | undefined;

export async function burnTimeLikeAVerify(): Promise<void> {
  // Generated once from a real hash rather than hard-coded: a hand-written
  // literal that fails to parse would be caught and return early, burning far
  // less time than a genuine verify and leaving the oracle wide open.
  dummyHash ??= hashPassword('a-password-nobody-will-ever-use');
  await verifyPassword('not-a-real-password', await dummyHash);
}

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Length plus a denylist, and deliberately no composition rules.
 *
 * Requiring a symbol and a digit reliably produces `Password1!`; length and
 * denylisting are the controls with evidence behind them.
 *
 * The check normalises before comparing, so `Password123!` does not slip past a
 * list containing `password123`.
 */
export function checkPasswordStrength(password: string, context: string[] = []): PasswordCheck {
  const normalised = password.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (COMMON_PASSWORDS.has(normalised)) {
    return { ok: false, reason: 'That password is too common. Choose something less guessable.' };
  }

  // A password containing the user's own email or name is trivially guessable
  // by anyone who knows either, which is everyone the account matters against.
  //
  // Each term is expanded before comparison: comparing only the whole address
  // misses the common case entirely, because nobody puts "@example.com" in
  // their password — they use the part before it. So `flow-test@example.com`
  // contributes `flowtestexamplecom`, `flowtest`, and each dot/dash-separated
  // fragment of the local part.
  for (const term of expandContextTerms(context)) {
    if (normalised.includes(term)) {
      return { ok: false, reason: 'Do not use your name or email address in your password.' };
    }
  }

  if (/^(.)\1+$/.test(normalised)) {
    return { ok: false, reason: 'That password is too repetitive.' };
  }

  // Long runs of sequential characters ("abcdefghijkl", "123456789012") pass a
  // length check while carrying almost no entropy.
  if (hasLongSequence(normalised)) {
    return { ok: false, reason: 'Avoid long sequences like "abcdefgh" or "12345678".' };
  }

  return { ok: true };
}

/**
 * Expands each context term into the forms a user might actually reuse.
 *
 * The minimum length is 5, not 4, and that one character matters. Substring
 * matching on short generic fragments is badly noisy: `info-desk@company.com`
 * yields `info`, which would then reject `information-security-99` — a
 * rejection the user cannot make sense of, for a password that is genuinely
 * fine. Five characters keeps the cases worth catching (`neeraj`, `sharma`,
 * a real surname or handle) and drops the ones that only generate confusion.
 *
 * Short local parts are a deliberate gap here; the length minimum, denylist,
 * sequence and repetition checks still apply to them.
 */
const MIN_CONTEXT_TERM_LENGTH = 5;

function expandContextTerms(context: string[]): string[] {
  const clean = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const terms = new Set<string>();

  for (const raw of context) {
    if (!raw) continue;
    terms.add(clean(raw));

    const atIndex = raw.indexOf('@');
    const localPart = atIndex === -1 ? raw : raw.slice(0, atIndex);
    terms.add(clean(localPart));

    // "first.last" and "first-last" reuse either half far more often than both.
    for (const fragment of localPart.split(/[._-]+/)) {
      terms.add(clean(fragment));
    }
  }

  return [...terms].filter((t) => t.length >= MIN_CONTEXT_TERM_LENGTH);
}

function hasLongSequence(value: string, threshold = 6): boolean {
  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < value.length; i += 1) {
    const delta = value.charCodeAt(i) - value.charCodeAt(i - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= threshold || descending >= threshold) return true;
  }
  return false;
}
