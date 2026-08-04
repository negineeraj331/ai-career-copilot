import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { MockProvider } from '@cc/ai';
import { createApp } from '../src/app.js';
import { closeDatabase, prisma } from '../src/core/db/prisma.js';
import { closeRedis, redis } from '../src/core/redis/client.js';
import { setAiProvider } from '../src/modules/ai/ai.service.js';
import {
  API as AUTH,
  STRONG_PASSWORD,
  type Client,
  del,
  get,
  makeClient,
  post,
  resetAuthState,
  tokenFromEmail,
} from './helpers/auth.js';

/**
 * Job descriptions and analysis, end to end.
 *
 * The mock AI provider stands in for extraction — no test contacts a real
 * provider — but everything around it is real: the content-hash reuse that keeps
 * the cost model honest, the deterministic match engine, and the cache that
 * stops an unchanged analysis being recomputed.
 */

const JOBS = '/api/v1/jobs';
const ANALYSIS = '/api/v1/analysis';
const RESUMES = '/api/v1/resumes';

let app: Express;
const EMAIL_PREFIX = 'analysis-';
let OWNER = '';
let STRANGER = '';

const POSTING = `Senior Backend Engineer at Acme.
We need strong Go and Kafka experience, and you must have worked with PostgreSQL.
Terraform is a plus. Five years of backend experience required. Bachelor's degree.`;

beforeEach(async () => {
  app = createApp();
  setAiProvider(new MockProvider());
  OWNER = `${EMAIL_PREFIX}owner-${randomUUID()}@example.com`;
  STRANGER = `${EMAIL_PREFIX}stranger-${randomUUID()}@example.com`;
  await resetAuthState([OWNER, STRANGER]);
  const keys = await redis().keys('cc:ai:*');
  const quota = await redis().keys('cc:quota:ai:*');
  if ([...keys, ...quota].length > 0) await redis().del(...keys, ...quota);
});

afterAll(async () => {
  setAiProvider(undefined);
  await prisma().user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await Promise.all([closeDatabase(), closeRedis()]);
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

async function makeJob(c: Client, text = POSTING): Promise<string> {
  const res = await post(c, JOBS, { title: 'Senior Backend Engineer', rawText: text }).expect(201);
  return res.body.data.id as string;
}

describe('job descriptions', () => {
  it('stores a posting and extracts its requirements', async () => {
    const c = await signIn(OWNER);
    const res = await post(c, JOBS, {
      title: 'Senior Backend Engineer',
      company: 'Acme',
      rawText: POSTING,
    }).expect(201);

    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.parsed).not.toBeNull();
    expect(res.body.data.parsed.roleTitle).toBeTruthy();
  });

  it('reuses an existing parse for identical text, from any user', async () => {
    const owner = await signIn(OWNER);
    await makeJob(owner);

    // A second user pastes the same posting. Extraction is the highest-volume
    // AI call in the product and the cost model only lands on budget because
    // this does not pay again — the parse is a pure function of the posting,
    // and whose account it landed in is not part of the answer.
    const provider = new MockProvider();
    setAiProvider(provider);
    const stranger = await signIn(STRANGER);
    const res = await post(stranger, JOBS, {
      title: 'Same posting',
      rawText: POSTING,
    }).expect(201);

    expect(res.body.data.parsed).not.toBeNull();
    expect(provider.calls).toHaveLength(0);
  });

  it('treats a posting differing only in whitespace as the same posting', async () => {
    const c = await signIn(OWNER);
    await makeJob(c);

    const provider = new MockProvider();
    setAiProvider(provider);
    await post(c, JOBS, { title: 'Padded', rawText: `${POSTING}   \n\n` }).expect(201);
    expect(provider.calls).toHaveLength(0);
  });

  it("does not show one user another user's postings", async () => {
    const owner = await signIn(OWNER);
    const id = await makeJob(owner);

    const stranger = await signIn(STRANGER);
    await get(stranger, `${JOBS}/${id}`).expect(404);
    await del(stranger, `${JOBS}/${id}`).expect(404);

    const list = await get(stranger, JOBS).expect(200);
    expect(list.body.data.jobs).toHaveLength(0);
  });

  it('requires a session', async () => {
    const anonymous = await makeClient(app);
    await post(anonymous, JOBS, { title: 'x', rawText: 'y' }).expect(401);
  });
});

describe('analysis', () => {
  it('scores a resume against a posting and explains the gaps', async () => {
    const c = await signIn(OWNER);
    const resumeId = await makeResume(c);
    const jobId = await makeJob(c);

    const res = await post(c, ANALYSIS, { resumeId, jobDescriptionId: jobId }).expect(201);
    const analysis = res.body.data.analysis;

    expect(analysis.atsScore).toBeGreaterThanOrEqual(0);
    expect(analysis.rubricVersion).toBe(1);
    expect(analysis.breakdown).not.toBeNull();
    // An empty starter resume against a real posting should have gaps and
    // advice, not a clean bill of health.
    expect(analysis.missingSkills.length).toBeGreaterThan(0);
    expect(analysis.recommendations.length).toBeGreaterThan(0);
  });

  it('works with no job description at all', async () => {
    const c = await signIn(OWNER);
    const resumeId = await makeResume(c);

    const res = await post(c, ANALYSIS, { resumeId }).expect(201);
    expect(res.body.data.analysis.matchScore).toBeNull();
    expect(res.body.data.analysis.breakdown).toBeNull();
    // Resume-level advice still applies — it is a property of the resume, not
    // of a match.
    expect(res.body.data.analysis.recommendations.length).toBeGreaterThan(0);
  });

  it('returns the stored analysis rather than recomputing an unchanged one', async () => {
    const c = await signIn(OWNER);
    const resumeId = await makeResume(c);
    const jobId = await makeJob(c);

    const first = await post(c, ANALYSIS, { resumeId, jobDescriptionId: jobId }).expect(201);
    const second = await post(c, ANALYSIS, { resumeId, jobDescriptionId: jobId }).expect(201);

    expect(second.body.data.analysis.id).toBe(first.body.data.analysis.id);
    expect(
      await prisma().analysis.count({
        where: { resumeVersionId: first.body.data.analysis.resumeVersionId },
      }),
    ).toBe(1);
  });

  it('produces a new analysis once the resume changes', async () => {
    const c = await signIn(OWNER);
    const resumeId = await makeResume(c);
    const jobId = await makeJob(c);
    const before = await get(c, `${RESUMES}/${resumeId}`).expect(200);

    const first = await post(c, ANALYSIS, { resumeId, jobDescriptionId: jobId }).expect(201);

    await c.agent
      .patch(`${RESUMES}/${resumeId}`)
      .set('X-CSRF-Token', c.csrf)
      .send({
        content: {
          ...before.body.data.resume.content,
          skills: [{ id: randomUUID(), category: 'Languages', skills: ['Go', 'Kafka'] }],
        },
      })
      .expect(200);

    const second = await post(c, ANALYSIS, { resumeId, jobDescriptionId: jobId }).expect(201);
    // Pinned to a version, not to a mutable resume: an analysis of "the resume"
    // would silently describe something the user has since changed.
    expect(second.body.data.analysis.id).not.toBe(first.body.data.analysis.id);
    expect(second.body.data.analysis.resumeVersionId).not.toBe(
      first.body.data.analysis.resumeVersionId,
    );
  });

  it('improves the match when the resume gains a required skill', async () => {
    const c = await signIn(OWNER);
    const resumeId = await makeResume(c);
    const jobId = await makeJob(c);
    const before = await get(c, `${RESUMES}/${resumeId}`).expect(200);

    const first = await post(c, ANALYSIS, { resumeId, jobDescriptionId: jobId }).expect(201);

    await c.agent
      .patch(`${RESUMES}/${resumeId}`)
      .set('X-CSRF-Token', c.csrf)
      .send({
        content: {
          ...before.body.data.resume.content,
          skills: [
            { id: randomUUID(), category: 'Languages', skills: ['Go', 'Kafka', 'PostgreSQL'] },
          ],
          experience: [
            {
              id: randomUUID(),
              company: 'Acme',
              role: 'Backend Engineer',
              dates: { start: '2019-01', end: null },
              bullets: [{ id: randomUUID(), text: 'Cut p95 latency from 800 ms to 120 ms.' }],
              technologies: ['Go', 'Kafka', 'PostgreSQL'],
            },
          ],
        },
      })
      .expect(200);

    const second = await post(c, ANALYSIS, { resumeId, jobDescriptionId: jobId }).expect(201);
    // The whole product promise: do the work, watch the number move.
    expect(second.body.data.analysis.matchScore).toBeGreaterThan(
      first.body.data.analysis.matchScore as number,
    );
  });

  it('updates the resume list score, so the dashboard reflects the analysis', async () => {
    const c = await signIn(OWNER);
    const resumeId = await makeResume(c);
    await post(c, ANALYSIS, { resumeId }).expect(201);

    const list = await get(c, RESUMES).expect(200);
    const listed = (list.body.data.items as { id: string; atsScore: number }[]).find(
      (r) => r.id === resumeId,
    );
    expect(listed?.atsScore).toBeGreaterThanOrEqual(0);
  });

  it("refuses to analyse another user's resume", async () => {
    const owner = await signIn(OWNER);
    const resumeId = await makeResume(owner);

    const stranger = await signIn(STRANGER);
    await post(stranger, ANALYSIS, { resumeId }).expect(404);
  });

  it("refuses to analyse against another user's posting", async () => {
    const owner = await signIn(OWNER);
    const jobId = await makeJob(owner);

    const stranger = await signIn(STRANGER);
    const resumeId = await makeResume(stranger);
    await post(stranger, ANALYSIS, { resumeId, jobDescriptionId: jobId }).expect(404);
  });

  it('lists analyses for a resume, newest first', async () => {
    const c = await signIn(OWNER);
    const resumeId = await makeResume(c);
    const jobId = await makeJob(c);

    await post(c, ANALYSIS, { resumeId }).expect(201);
    await post(c, ANALYSIS, { resumeId, jobDescriptionId: jobId }).expect(201);

    const res = await get(c, `${ANALYSIS}?resumeId=${resumeId}`).expect(200);
    expect(res.body.data.analyses).toHaveLength(2);
    expect(res.body.data.analyses[0].jobDescriptionId).toBe(jobId);
  });

  it("will not show one user another user's analysis", async () => {
    const owner = await signIn(OWNER);
    const resumeId = await makeResume(owner);
    const created = await post(owner, ANALYSIS, { resumeId }).expect(201);

    const stranger = await signIn(STRANGER);
    await get(stranger, `${ANALYSIS}/${created.body.data.analysis.id as string}`).expect(404);
  });
});
