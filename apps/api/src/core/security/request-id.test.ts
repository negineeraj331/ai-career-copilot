import { describe, expect, it } from 'vitest';
import { truncateIp } from './request-id.js';

/**
 * Pure, so it should always have had unit tests. It did not, and the gap cost
 * a real bug: the IPv4-mapped IPv6 form that Node returns on every dual-stack
 * socket fell through to the IPv6 branch and produced `ffff:127.0.0.1::` —
 * neither truncated nor valid. Integration tests missed it because they only
 * asserted the audit log, which reads a different code path.
 */
describe('truncateIp', () => {
  it('truncates IPv4 to /24', () => {
    expect(truncateIp('203.0.113.42')).toBe('203.0.113.x');
    expect(truncateIp('127.0.0.1')).toBe('127.0.0.x');
    expect(truncateIp('10.1.2.3')).toBe('10.1.2.x');
  });

  it('truncates the IPv4-mapped IPv6 form Node actually returns', () => {
    // The regression. This is the default shape on a dual-stack listener.
    expect(truncateIp('::ffff:127.0.0.1')).toBe('127.0.0.x');
    expect(truncateIp('::ffff:203.0.113.42')).toBe('203.0.113.x');
    expect(truncateIp('::FFFF:203.0.113.42')).toBe('203.0.113.x');
  });

  it('truncates IPv6 to /48', () => {
    expect(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
  });

  it('handles loopback and other ::-prefixed addresses', () => {
    expect(truncateIp('::1')).toBe('::');
    expect(truncateIp('::')).toBe('::');
  });

  it('never returns something longer or more identifying than its input', () => {
    for (const ip of [
      '203.0.113.42',
      '::ffff:203.0.113.42',
      '2001:db8:85a3:8d3:1319:8a2e:370:7348',
    ]) {
      const result = truncateIp(ip);
      expect(result).toBeDefined();
      expect(result).not.toBe(ip);
      // The final octet or the trailing groups must be gone.
      expect(result).toMatch(/(\.x$|::$)/);
    }
  });

  it('returns undefined for absent or unparseable input', () => {
    expect(truncateIp(undefined)).toBeUndefined();
    expect(truncateIp('not-an-ip')).toBeUndefined();
    expect(truncateIp('')).toBeUndefined();
  });
});
