import { env } from '../../config/env.js';
import { QuotaExceededError } from '../../core/errors/app-error.js';
import { redis } from '../../core/redis/client.js';

/**
 * Monthly AI quota, consumed before dispatch (docs/11 §8).
 *
 * "Before" is the whole design. Charging after the call means a user at their
 * limit still costs money on the request that gets rejected, and a burst of
 * concurrent requests all pass a check that has not yet been decremented.
 *
 * The reserve/release pair exists because a reservation that is never returned
 * is a slow leak: a provider outage would silently burn a user's month. Anything
 * that fails before the provider was actually paid gives the unit back.
 */

export type Tier = 'FREE' | 'PRO' | 'TEAM';

/** Fixed calendar month, so the allowance resets on a date a user can predict. */
function periodKey(now: Date): string {
  return `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function quotaKey(userId: string, now: Date): string {
  return `cc:quota:ai:${periodKey(now)}:${userId}`;
}

export function limitFor(tier: Tier): number {
  switch (tier) {
    case 'PRO':
    case 'TEAM':
      return env().QUOTA_PRO_AI_ACTIONS;
    default:
      return env().QUOTA_FREE_AI_ACTIONS;
  }
}

/**
 * INCR then compare, with the TTL set only on first write.
 *
 * Atomic by construction: two concurrent requests get 1 and 2, never 1 and 1.
 * A read-then-write would let both see the same count and both proceed, which
 * is precisely how a "limit 10" becomes a limit of however many requests arrive
 * in the same millisecond.
 */
const CONSUME_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return -1
end
return current
`;

// 35 days: comfortably longer than any month, so a key never expires mid-period
// and hands somebody a fresh allowance early.
const TTL_SECONDS = 35 * 24 * 60 * 60;

export interface QuotaReservation {
  used: number;
  limit: number;
  release: () => Promise<void>;
}

export async function reserve(
  userId: string,
  tier: Tier,
  now = new Date(),
): Promise<QuotaReservation> {
  const limit = limitFor(tier);
  const key = quotaKey(userId, now);

  const result = (await redis().eval(
    CONSUME_SCRIPT,
    1,
    key,
    String(limit),
    String(TTL_SECONDS),
  )) as number;

  if (result === -1) {
    throw new QuotaExceededError(
      `You have used all ${String(limit)} AI actions for this month. They reset on the 1st.`,
      [{ field: 'quota', message: `limit=${String(limit)}` }],
    );
  }

  let released = false;
  return {
    used: result,
    limit,
    release: async () => {
      // Idempotent: a caller that releases in both a catch and a finally must
      // not hand back two units.
      if (released) return;
      released = true;
      await redis().decr(key);
    },
  };
}

export async function usage(
  userId: string,
  tier: Tier,
  now = new Date(),
): Promise<{ used: number; limit: number; remaining: number }> {
  const raw = await redis().get(quotaKey(userId, now));
  const used = raw ? Number(raw) : 0;
  const limit = limitFor(tier);
  return { used, limit, remaining: Math.max(0, limit - used) };
}
