import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { closeDatabase, prisma } from '../src/core/db/prisma.js';
import { closeRedis } from '../src/core/redis/client.js';
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
 * The HTTP surface of the scoring engine (slice 1.2).
 *
 * The rubric itself is unit-tested in packages/ats against no database at all;
 * these tests cover only what that package cannot: ownership, validation, and
 * the score reaching the stored resume row.
 */

const ATS = '/api/v1/ats';
const RESUMES = '/api/v1/resumes';

let app: Express;
let client: Client;

const EMAIL_PREFIX = 'ats-';
let OWNER = '';
let STRANGER = '';

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  OWNER = `${EMAIL_PREFIX}owner-${randomUUID()}@example.com`;
  STRANGER = `${EMAIL_PREFIX}stranger-${randomUUID()}@example.com`;
  await resetAuthState([OWNER, STRANGER]);
  client = await makeClient(app);
});

afterAll(async () => {
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

describe('POST /ats/score', () => {
  it('requires a session', async () => {
    await post(client, `${ATS}/score`, { resumeId: randomUUID() }).expect(401);
  });

  it('scores a stored resume with a full breakdown', async () => {
    const c = await signIn(OWNER);
    const created = await post(c, RESUMES, { title: 'Backend SDE' }).expect(201);
    const resumeId = created.body.data.resume.id as string;

    const res = await post(c, `${ATS}/score`, { resumeId }).expect(200);
    const { score, rubricVersion, components, rules, topFixes } = res.body.data;

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(rubricVersion).toBe(1);
    // Every component reported, so the UI can render the breakdown without
    // guessing which ones exist.
    expect(Object.keys(components).sort()).toEqual([
      'completeness',
      'formatting',
      'keywords',
      'parseability',
      'readability',
    ]);
    expect(rules.length).toBeGreaterThan(15);
    // Every finding carries a human explanation (FR-42).
    for (const rule of rules) expect(rule.explanation.length).toBeGreaterThan(0);
    // And the actionable ones come with a fix.
    for (const fix of topFixes) expect(fix.fix).toBeTruthy();
  });

  it('scores an unsaved document, so the editor can show a live score', async () => {
    const c = await signIn(OWNER);
    const created = await post(c, RESUMES, { title: 'Draft' }).expect(201);
    const content = created.body.data.resume.content;

    const res = await post(c, `${ATS}/score`, {
      content: { ...content, summary: 'Backend engineer with five years of payments experience.' },
    }).expect(200);

    expect(res.body.data.score).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic across repeated calls (FR-40)', async () => {
    const c = await signIn(OWNER);
    const created = await post(c, RESUMES, { title: 'Same' }).expect(201);
    const resumeId = created.body.data.resume.id as string;

    const first = await post(c, `${ATS}/score`, { resumeId }).expect(200);
    const second = await post(c, `${ATS}/score`, { resumeId }).expect(200);
    expect(first.body.data).toEqual(second.body.data);
  });

  it("will not score another user's resume", async () => {
    const owner = await signIn(OWNER);
    const created = await post(owner, RESUMES, { title: 'Private' }).expect(201);
    const resumeId = created.body.data.resume.id as string;

    const stranger = await signIn(STRANGER);
    await post(stranger, `${ATS}/score`, { resumeId }).expect(404);
  });

  it('rejects a request with neither resumeId nor content', async () => {
    const c = await signIn(OWNER);
    await post(c, `${ATS}/score`, {}).expect(400);
  });

  it('rejects a request with both', async () => {
    const c = await signIn(OWNER);
    const created = await post(c, RESUMES, { title: 'Both' }).expect(201);
    await post(c, `${ATS}/score`, {
      resumeId: created.body.data.resume.id,
      content: created.body.data.resume.content,
    }).expect(400);
  });

  it('rejects a malformed document rather than scoring nonsense', async () => {
    const c = await signIn(OWNER);
    await post(c, `${ATS}/score`, { content: { schemaVersion: 1 } }).expect(400);
  });
});

describe('the stored score', () => {
  it('is written on create and updated when content changes', async () => {
    const c = await signIn(OWNER);
    const created = await post(c, RESUMES, { title: 'Improving' }).expect(201);
    const resumeId = created.body.data.resume.id as string;
    const before = created.body.data.resume.atsScore as number;

    const improved = {
      ...created.body.data.resume.content,
      summary:
        'Backend engineer with five years building payment infrastructure. Cut settlement latency by 60 percent across a system handling 40 million transactions a month.',
      skills: [
        {
          id: randomUUID(),
          category: 'Languages',
          skills: ['Go', 'Python', 'SQL', 'Rust', 'TypeScript', 'Java'],
        },
      ],
    };

    const updated = await c.agent
      .patch(`${RESUMES}/${resumeId}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: improved })
      .expect(200);

    // A materially better document must score better. This is the assertion
    // that would catch the score being written but never recomputed.
    expect(updated.body.data.resume.atsScore).toBeGreaterThan(before);

    // And it is persisted, not just returned.
    const listed = await get(c, RESUMES).expect(200);
    expect(listed.body.data.items[0].atsScore).toBe(updated.body.data.resume.atsScore);
  });

  it('matches what the scoring endpoint reports for the same document', async () => {
    const c = await signIn(OWNER);
    const created = await post(c, RESUMES, { title: 'Consistent' }).expect(201);
    const resumeId = created.body.data.resume.id as string;

    const endpoint = await post(c, `${ATS}/score`, { resumeId }).expect(200);
    // Two paths to the same number. If they ever diverge, one of them is
    // passing different options to the engine and the list view is lying.
    expect(created.body.data.resume.atsScore).toBe(endpoint.body.data.score);
  });
});
