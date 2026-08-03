import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../../src/core/db/prisma.js';
import { redis } from '../../src/core/redis/client.js';
import { type InMemoryMailer, mailer } from '../../src/services/mailer/mailer.js';

/**
 * Helpers for auth integration tests.
 *
 * Every request needs a CSRF token and cookie jar, so tests use a supertest
 * agent seeded from a GET. Doing this by hand in each test would bury the
 * behaviour being asserted under ceremony.
 */

export const API = '/api/v1/auth';

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
}

/** An agent holding a cookie jar and a matching CSRF token. */
export async function makeClient(app: Express): Promise<Client> {
  const agent = request.agent(app);
  const res = await agent.get(`${API}/me`);
  const cookies = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const csrfCookie = cookies.find((c) => c.startsWith('cc_csrf='));
  const csrf = csrfCookie?.split(';')[0]?.split('=')[1] ?? '';
  return { agent, csrf };
}

export function post(client: Client, path: string, body?: unknown) {
  const req = client.agent.post(path).set('X-CSRF-Token', client.csrf);
  return body === undefined ? req : req.send(body as object);
}

export function del(client: Client, path: string, body?: unknown) {
  const req = client.agent.delete(path).set('X-CSRF-Token', client.csrf);
  return body === undefined ? req : req.send(body as object);
}

export function get(client: Client, path: string) {
  return client.agent.get(path);
}

export function testMailer(): InMemoryMailer {
  return mailer() as InMemoryMailer;
}

/** Pull the token out of the most recent email matching a subject fragment. */
export function tokenFromEmail(subjectFragment: string): string {
  const message = [...testMailer().sent]
    .reverse()
    .find((m) => m.subject.toLowerCase().includes(subjectFragment.toLowerCase()));
  if (!message) throw new Error(`No email matching "${subjectFragment}". Sent: ${describeSent()}`);

  const match = /token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match?.[1]) throw new Error(`No token in email "${message.subject}"`);
  return match[1];
}

export function emailWasSent(subjectFragment: string): boolean {
  return testMailer().sent.some((m) =>
    m.subject.toLowerCase().includes(subjectFragment.toLowerCase()),
  );
}

function describeSent(): string {
  return (
    testMailer()
      .sent.map((m) => m.subject)
      .join(' | ') || '(none)'
  );
}

/**
 * Reset everything a previous test could have left behind: rate-limit counters
 * in Redis, lockout rows, and the accounts themselves. Without this the suite
 * passes or fails depending on execution order, which is worse than failing.
 */
export async function resetAuthState(emails: string[]): Promise<void> {
  testMailer().clear();

  const keys = await redis().keys('cc:rl:*');
  if (keys.length > 0) await redis().del(...keys);

  await prisma().loginAttempt.deleteMany({});

  if (emails.length > 0) {
    await prisma().user.deleteMany({ where: { email: { in: emails } } });
  }
}

export const STRONG_PASSWORD = 'thicket-marmalade-99-vault';
