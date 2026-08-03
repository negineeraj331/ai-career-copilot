import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { runWithContext } from '../logger/request-context.js';

/** Trust an inbound id only if it looks like one we would have issued.
 *  It ends up in logs and in responses, so an unvalidated header is a log
 *  injection and a response-splitting vector. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

function truncateIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  // Store /24 for IPv4 and /48 for IPv6 (docs/12 §8) — enough to recognise a
  // session or rate-limit a network, less PII than a full address.
  if (ip.includes(':')) {
    const groups = ip.split(':').filter(Boolean);
    return `${groups.slice(0, 3).join(':')}::`;
  }
  const octets = ip.split('.');
  if (octets.length !== 4) return undefined;
  return `${octets.slice(0, 3).join('.')}.x`;
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
