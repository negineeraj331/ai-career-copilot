import type { Server } from 'node:http';
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

/**
 * One listening server per app, reused by every client.
 *
 * Handing `request.agent()` an Express app rather than a server makes supertest
 * bind a fresh ephemeral port for that agent. The suite creates a client per
 * signed-in user per test, so that was hundreds of listen/close cycles per run
 * and thousands of sockets stuck in TIME_WAIT (measured: 1213 on this machine).
 * The result was a suite that failed roughly one run in ten with `ECONNRESET`
 * or an unexplained 401 — connection-level noise wearing the costume of an
 * application bug.
 *
 * `unref()` so a stray listener cannot keep the process alive after the run.
 */
const servers = new WeakMap<Express, Server>();

function serverFor(app: Express): Server {
  const existing = servers.get(app);
  if (existing) return existing;

  const server = app.listen(0);
  server.unref();
  servers.set(app, server);
  return server;
}

/** An agent holding a cookie jar and a matching CSRF token. */
export async function makeClient(app: Express): Promise<Client> {
  const agent = request.agent(serverFor(app));
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

/**
 * Pull the token out of the most recent email sent TO `recipient` matching a
 * subject fragment.
 *
 * The recipient is required, and that is the whole point. Vitest runs test
 * files in parallel against one in-memory mailer, and several files send a
 * message whose subject is "verify your email" — to different addresses. A
 * lookup by subject alone returns whichever landed last, so one file could
 * consume another file's token and fail with a misleading 400. Scoping by
 * recipient makes each file's mailbox effectively its own.
 */
export function tokenFromEmail(subjectFragment: string, recipient: string): string {
  const message = [...testMailer().sent]
    .reverse()
    .find(
      (m) =>
        m.to.toLowerCase() === recipient.toLowerCase() &&
        m.subject.toLowerCase().includes(subjectFragment.toLowerCase()),
    );
  if (!message) {
    throw new Error(
      `No email to ${recipient} matching "${subjectFragment}". Sent: ${describeSent()}`,
    );
  }

  const match = /token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match?.[1]) throw new Error(`No token in email "${message.subject}"`);
  return match[1];
}

export function emailWasSent(subjectFragment: string, recipient: string): boolean {
  return testMailer().sent.some(
    (m) =>
      m.to.toLowerCase() === recipient.toLowerCase() &&
      m.subject.toLowerCase().includes(subjectFragment.toLowerCase()),
  );
}

function describeSent(): string {
  return (
    testMailer()
      .sent.map((m) => `${m.to}: ${m.subject}`)
      .join(' | ') || '(none)'
  );
}

/**
 * Reset everything a previous test could have left behind: rate-limit counters
 * in Redis, lockout rows, and the accounts themselves. Without this the suite
 * passes or fails depending on execution order, which is worse than failing.
 */
export async function resetAuthState(emails: string[]): Promise<void> {
  // Prune only this file's own messages. `clear()` empties the mailbox for
  // every file at once, and with parallel test files that wipes messages
  // another file is between sending and reading — an intermittent "No email
  // matching …" that looks like a bug in the code under test.
  const sent = testMailer().sent;
  const targets = new Set(emails.map((e) => e.toLowerCase()));
  for (let i = sent.length - 1; i >= 0; i--) {
    if (targets.has((sent[i]?.to ?? '').toLowerCase())) sent.splice(i, 1);
  }

  const keys = await redis().keys('cc:rl:*');
  if (keys.length > 0) await redis().del(...keys);

  await prisma().loginAttempt.deleteMany({});

  if (emails.length > 0) {
    await prisma().user.deleteMany({ where: { email: { in: emails } } });
  }
}

export const STRONG_PASSWORD = 'thicket-marmalade-99-vault';
