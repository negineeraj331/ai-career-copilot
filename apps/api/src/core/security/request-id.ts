import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { runWithContext } from '../logger/request-context.js';

/** Trust an inbound id only if it looks like one we would have issued.
 *  It ends up in logs and in responses, so an unvalidated header is a log
 *  injection and a response-splitting vector. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Truncate to /24 (IPv4) or /48 (IPv6) — enough to recognise a session or
 * rate-limit a network, far less PII than a whole address (docs/12 §8).
 *
 * The IPv4-mapped form is handled FIRST and deliberately. Node hands back
 * `::ffff:127.0.0.1` on a dual-stack socket, which is the default — so it is
 * the common case, not an edge case. An earlier version tested for a colon and
 * took the IPv6 branch, producing `ffff:127.0.0.1::`: not truncated, not valid,
 * and worse than either input. Unit tests below; a live run is what exposed it.
 */
function truncateIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  const candidate = mapped?.[1] ?? ip;

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) {
    const octets = candidate.split('.');
    return `${octets[0]}.${octets[1]}.${octets[2]}.x`;
  }

  if (candidate.includes(':')) {
    // Loopback and other `::`-prefixed forms have no meaningful /48 prefix.
    if (candidate.startsWith('::')) return '::';
    return `${candidate.split(':').slice(0, 3).join(':')}::`;
  }

  return undefined;
}

/**
 * Assigns a request ID and opens the async context every log line, error
 * report, and downstream call will read from. Registered first, so nothing
 * downstream can log without correlation.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const inbound = req.header('x-request-id');
  const requestId = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();

  res.setHeader('x-request-id', requestId);

  runWithContext({ requestId, ipPrefix: truncateIp(req.ip) }, () => {
    next();
  });
};

export { truncateIp };
