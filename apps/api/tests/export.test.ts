import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { closeDatabase, prisma } from '../src/core/db/prisma.js';
import { closeRedis } from '../src/core/redis/client.js';
import { closeQueues } from '../src/core/queue/queue.js';
import { processExportJob } from '../src/modules/export/export.worker.js';
import {
  API as AUTH,
  STRONG_PASSWORD,
  type Client,
  get,
  makeClient,
  post,
  resetAuthState,
  tokenFromEmail,
} from './helpers/auth.js';

/**
 * The export pipeline, end to end against real Postgres, Redis, and MinIO.
 *
 * The worker body is invoked directly rather than through a running BullMQ
 * consumer: what matters is that a job renders, stores, and records its result,
 * and standing up a second process would test BullMQ rather than us. The
 * enqueue path is covered separately by asserting the queue actually received
 * the job.
 */

const RESUMES = '/api/v1/resumes';
const EXPORTS = '/api/v1/exports';

let app: Express;
const EMAIL_PREFIX = 'export-';
let OWNER = '';
let STRANGER = '';

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  OWNER = `${EMAIL_PREFIX}owner-${randomUUID()}@example.com`;
  STRANGER = `${EMAIL_PREFIX}stranger-${randomUUID()}@example.com`;
  await resetAuthState([OWNER, STRANGER]);
});

afterAll(async () => {
  await prisma().user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await Promise.all([closeQueues(), closeDatabase(), closeRedis()]);
});

async function signIn(email: string): Promise<Client> {
  const c = await makeClient(app);
  await post(c, `${AUTH}/register`, { email, password: STRONG_PASSWORD }).expect(201);
  await post(c, `${AUTH}/verify-email`, {
    token: tokenFromEmail('verify your email', email),
  }).expect(200);
  await post(c, `${AUTH}/login`, { email, password: STRONG_PASSWORD }).expect(200);
  return c;
}

async function makeResume(c: Client): Promise<string> {
  const res = await post(c, RESUMES, { title: 'Backend SDE' }).expect(201);
  return res.body.data.resume.id as string;
}

describe('enqueueing', () => {
  it('returns 202 with a job and a status URL, not a finished file', async () => {
    const c = await signIn(OWNER);
    const id = await makeResume(c);

    const res = await post(c, `${RESUMES}/${id}/export`, { format: 'MARKDOWN' }).expect(202);

    // 202 is the contract: rendering a PDF takes seconds, and holding an HTTP
    // connection open for it would tie up a web process and time out behind any
    // sensible proxy.
    expect(res.body.data.jobId).toBeTruthy();
    expect(res.body.data.statusUrl).toBe(`/api/v1/exports/${res.body.data.jobId as string}`);
    expect(res.body.data.job.status).toBe('QUEUED');
  });

  it('pins the current version, so a later edit cannot change the export', async () => {
    const c = await signIn(OWNER);
    const id = await makeResume(c);
    const before = await get(c, `${RESUMES}/${id}`).expect(200);

    const enqueued = await post(c, `${RESUMES}/${id}/export`, { format: 'JSON' }).expect(202);
    const job = await prisma().exportJob.findUniqueOrThrow({
      where: { id: enqueued.body.data.jobId as string },
    });

    // Edit after enqueueing.
    await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: { ...before.body.data.resume.content, summary: 'Changed after enqueue.' } })
      .expect(200);

    await processExportJob(job.id, 1);

    const version = await prisma().resumeVersion.findUniqueOrThrow({
      where: { id: job.versionId },
    });
    // The pinned version is the one that was current at enqueue time, and the
    // edit created a new one — so the export is of what the user was looking at.
    expect((version.content as { summary?: string }).summary).not.toBe('Changed after enqueue.');
  });

  it("defaults to the resume's own template", async () => {
    const c = await signIn(OWNER);
    const res = await post(c, RESUMES, { title: 'Serif', templateId: 'classic-serif' }).expect(201);
    const enqueued = await post(c, `${RESUMES}/${res.body.data.resume.id as string}/export`, {
      format: 'MARKDOWN',
    }).expect(202);
    expect(enqueued.body.data.job.templateId).toBe('classic-serif');
  });

  it('rejects an unknown format', async () => {
    const c = await signIn(OWNER);
    const id = await makeResume(c);
    await post(c, `${RESUMES}/${id}/export`, { format: 'WORDPERFECT' }).expect(400);
  });

  it("will not export another user's resume", async () => {
    const owner = await signIn(OWNER);
    const id = await makeResume(owner);
    const stranger = await signIn(STRANGER);
    await post(stranger, `${RESUMES}/${id}/export`, { format: 'JSON' }).expect(404);
  });

  it('requires a session', async () => {
    const anonymous = await makeClient(app);
    await post(anonymous, `${RESUMES}/${randomUUID()}/export`, { format: 'JSON' }).expect(401);
  });
});

describe('rendering', () => {
  it.each(['JSON', 'MARKDOWN', 'LATEX', 'DOCX'] as const)(
    'renders %s, stores it, and marks the job ready',
    async (format) => {
      const c = await signIn(OWNER);
      const id = await makeResume(c);
      const enqueued = await post(c, `${RESUMES}/${id}/export`, { format }).expect(202);
      const jobId = enqueued.body.data.jobId as string;

      await processExportJob(jobId, 1);

      const job = await prisma().exportJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(job.status).toBe('READY');
      expect(job.objectKey).toBeTruthy();
      expect(job.bytes).toBeGreaterThan(0);
      expect(job.error).toBeNull();
      expect(job.completedAt).not.toBeNull();
    },
  );

  it('namespaces the object key by user, so a bucket listing cannot be walked', async () => {
    const c = await signIn(OWNER);
    const id = await makeResume(c);
    const enqueued = await post(c, `${RESUMES}/${id}/export`, { format: 'JSON' }).expect(202);
    await processExportJob(enqueued.body.data.jobId as string, 1);

    const job = await prisma().exportJob.findUniqueOrThrow({
      where: { id: enqueued.body.data.jobId as string },
    });
    expect(job.objectKey).toBe(`${job.userId}/${job.id}.json`);
  });

  it('records a user-facing message and rethrows when PDF has no browser', async () => {
    const previous = process.env.CHROMIUM_PATH;
    delete process.env.CHROMIUM_PATH;
    try {
      const c = await signIn(OWNER);
      const id = await makeResume(c);
      const enqueued = await post(c, `${RESUMES}/${id}/export`, { format: 'PDF' }).expect(202);
      const jobId = enqueued.body.data.jobId as string;

      // Rethrown so BullMQ counts the attempt and retries with backoff.
      await expect(processExportJob(jobId, 1)).rejects.toThrow(/Chromium/i);

      const job = await prisma().exportJob.findUniqueOrThrow({ where: { id: jobId } });
      // But the row is updated first, so a client polling between attempts sees
      // a failure it can act on rather than a job stuck in RUNNING forever.
      expect(job.status).toBe('FAILED');
      expect(job.error).toMatch(/PDF export is temporarily unavailable/);
      // The message is written for a user; the stack trace goes to the logs.
      expect(job.error).not.toMatch(/CHROMIUM_PATH|Error:/);
    } finally {
      if (previous !== undefined) process.env.CHROMIUM_PATH = previous;
    }
  });
});

describe('status', () => {
  it('hands back a signed download URL only once the job is ready', async () => {
    const c = await signIn(OWNER);
    const id = await makeResume(c);
    const enqueued = await post(c, `${RESUMES}/${id}/export`, { format: 'MARKDOWN' }).expect(202);
    const jobId = enqueued.body.data.jobId as string;

    const queued = await get(c, `${EXPORTS}/${jobId}`).expect(200);
    expect(queued.body.data.job.status).toBe('QUEUED');
    expect(queued.body.data.job.downloadUrl).toBeUndefined();

    await processExportJob(jobId, 1);

    const ready = await get(c, `${EXPORTS}/${jobId}`).expect(200);
    expect(ready.body.data.job.status).toBe('READY');
    // Pre-signed and straight to the bucket: a 2 MB PDF must not occupy a Node
    // process for the length of a slow mobile connection.
    expect(ready.body.data.job.downloadUrl).toMatch(/X-Amz-Signature/);
  });

  it("will not show another user's export", async () => {
    const owner = await signIn(OWNER);
    const id = await makeResume(owner);
    const enqueued = await post(owner, `${RESUMES}/${id}/export`, { format: 'JSON' }).expect(202);

    const stranger = await signIn(STRANGER);
    await get(stranger, `${EXPORTS}/${enqueued.body.data.jobId as string}`).expect(404);
  });

  it('lists the exports for a resume, newest first', async () => {
    const c = await signIn(OWNER);
    const id = await makeResume(c);
    await post(c, `${RESUMES}/${id}/export`, { format: 'JSON' }).expect(202);
    await post(c, `${RESUMES}/${id}/export`, { format: 'MARKDOWN' }).expect(202);

    const res = await get(c, `${RESUMES}/${id}/export`).expect(200);
    expect(res.body.data.jobs).toHaveLength(2);
    expect(res.body.data.jobs[0].format).toBe('MARKDOWN');
  });
});
