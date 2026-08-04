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
  get,
  makeClient,
  post,
  resetAuthState,
  tokenFromEmail,
} from './helpers/auth.js';

/**
 * The write-capable AI features, and the guarantee that matters most: nothing
 * containing an unfilled placeholder can reach a stored resume.
 *
 * docs/11 puts that enforcement in the client. These tests are the reason it is
 * also on the server — a rule that lives only in the UI holds until someone
 * writes a script, a second client, or a bug.
 */

const AI = '/api/v1/ai';
const RESUMES = '/api/v1/resumes';

let app: Express;
const EMAIL_PREFIX = 'writing-';
let OWNER = '';

beforeEach(async () => {
  app = createApp();
  setAiProvider(new MockProvider());
  OWNER = `${EMAIL_PREFIX}${randomUUID()}@example.com`;
  await resetAuthState([OWNER]);
  const keys = await redis().keys('cc:ai:*');
  const quota = await redis().keys('cc:quota:ai:*');
  if ([...keys, ...quota].length > 0) await redis().del(...keys, ...quota);
});

afterAll(async () => {
  setAiProvider(undefined);
  await prisma().user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await Promise.all([closeDatabase(), closeRedis()]);
});

async function signIn(): Promise<Client> {
  const c = await makeClient(app);
  await post(c, `${AUTH}/register`, { email: OWNER, password: STRONG_PASSWORD }).expect(201);
  await post(c, `${AUTH}/verify-email`, {
    token: tokenFromEmail('verify your email', OWNER),
  }).expect(200);
  await post(c, `${AUTH}/login`, { email: OWNER, password: STRONG_PASSWORD }).expect(200);
  return c;
}

describe('bullet optimisation', () => {
  it('returns a proposal per bullet, never an applied edit', async () => {
    const c = await signIn();
    const res = await post(c, `${AI}/bullet/optimize`, {
      bullets: [
        { id: 'b1', text: 'Responsible for the backend' },
        { id: 'b2', text: 'Helped with deployments' },
      ],
    }).expect(200);

    expect(res.body.data.proposals).toHaveLength(2);
    for (const proposal of res.body.data.proposals) {
      // before/after/rationale/confidence is the whole point: the user judges
      // the change rather than being asked to trust it.
      expect(proposal.after).toBeTruthy();
      expect(proposal.rationale).toBeTruthy();
      expect(proposal.confidence).toBeGreaterThanOrEqual(0);
      expect(proposal.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('keys each proposal to the bullet it came from', async () => {
    const c = await signIn();
    const res = await post(c, `${AI}/bullet/optimize`, {
      bullets: [{ id: 'bullet-abc', text: 'Responsible for the backend' }],
    }).expect(200);

    // Keyed by id rather than matched on text, so a proposal can be applied
    // even if the bullet has been edited since.
    expect(res.body.data.proposals[0].id).toBe('bullet:bullet-abc');
    expect(res.body.data.proposals[0].before).toBeTruthy();
  });

  it('reports the quota left, so the UI can warn before the last one', async () => {
    const c = await signIn();
    const res = await post(c, `${AI}/bullet/optimize`, {
      bullets: [{ id: 'b', text: 'Did some work on the platform' }],
    }).expect(200);
    expect(res.body.data.quotaRemaining).toBeGreaterThanOrEqual(0);
  });

  it('rejects an empty or oversized batch', async () => {
    const c = await signIn();
    await post(c, `${AI}/bullet/optimize`, { bullets: [] }).expect(400);
    await post(c, `${AI}/bullet/optimize`, {
      bullets: Array.from({ length: 11 }, (_, i) => ({ id: String(i), text: 'x' })),
    }).expect(400);
  });

  it('requires a session', async () => {
    const anonymous = await makeClient(app);
    await post(anonymous, `${AI}/bullet/optimize`, {
      bullets: [{ id: 'b', text: 'x' }],
    }).expect(401);
  });
});

describe('bullet generation', () => {
  it('turns a plain description into one bullet', async () => {
    const c = await signIn();
    const res = await post(c, `${AI}/bullet/generate`, {
      rawInput: 'I made the checkout page load faster by caching the product catalogue',
    }).expect(200);

    expect(res.body.data.proposals).toHaveLength(1);
    // Nothing to compare against, so `before` is null rather than an invented
    // original.
    expect(res.body.data.proposals[0].before).toBeNull();
  });

  it('refuses input too short to be a description of work', async () => {
    const c = await signIn();
    await post(c, `${AI}/bullet/generate`, { rawInput: 'did stuff' }).expect(400);
  });
});

describe('skill suggestions', () => {
  it('returns skills with the evidence for each', async () => {
    const c = await signIn();
    const res = await post(c, `${AI}/skills/suggest`, {
      resumeText:
        'Built a Kafka consumer in Go, deployed on Kubernetes, with Terraform for the infrastructure.',
    }).expect(200);

    for (const skill of res.body.data.skills) {
      // A suggestion without evidence is a guess the user cannot evaluate.
      expect(skill.name).toBeTruthy();
      expect(skill.evidence).toBeTruthy();
    }
  });
});

describe('quota endpoint', () => {
  it('keeps working precisely when the quota has run out', async () => {
    const c = await signIn();
    const before = await get(c, `${AI}/usage`).expect(200);
    expect(before.body.data.limit).toBeGreaterThan(0);

    // Spend it all.
    for (let i = 0; i < before.body.data.limit; i += 1) {
      await post(c, `${AI}/bullet/generate`, {
        rawInput: `Distinct piece of work number ${String(i)} on the platform`,
      });
    }

    const after = await get(c, `${AI}/usage`).expect(200);
    // Reading your own quota costs nothing and must not be gated by it —
    // otherwise the one moment a user needs the number is the moment it 429s.
    expect(after.body.data.remaining).toBe(0);
  });
});

describe('the placeholder guarantee', () => {
  it('refuses to store a bullet containing an unfilled placeholder', async () => {
    const c = await signIn();
    const created = await post(c, RESUMES, { title: 'Guard' }).expect(201);
    const id = created.body.data.resume.id as string;
    const content = created.body.data.resume.content;

    const res = await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({
        content: {
          ...content,
          experience: [
            {
              id: randomUUID(),
              company: 'Acme',
              role: 'Engineer',
              dates: { start: '2022-01', end: null },
              bullets: [{ id: randomUUID(), text: 'Improved latency by [X]% for [N] users.' }],
              technologies: [],
            },
          ],
        },
      })
      .expect(422);

    // The failure names the field and the placeholder, so the UI can point at
    // it rather than saying "something is wrong".
    expect(res.body.error.details[0].field).toContain('bullets');
    expect(res.body.error.details[0].message).toContain('[X]');
  });

  it('refuses a placeholder in the summary too', async () => {
    const c = await signIn();
    const created = await post(c, RESUMES, { title: 'Guard' }).expect(201);
    await c.agent
      .patch(`${RESUMES}/${created.body.data.resume.id as string}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: { ...created.body.data.resume.content, summary: 'Cut costs by [X]%.' } })
      .expect(422);
  });

  it('accepts the same bullet once the figure is filled in', async () => {
    const c = await signIn();
    const created = await post(c, RESUMES, { title: 'Guard' }).expect(201);
    const id = created.body.data.resume.id as string;

    await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({
        content: {
          ...created.body.data.resume.content,
          summary: 'Cut costs by 40%.',
        },
      })
      .expect(200);
  });

  it('does not reject square brackets a person legitimately wrote', async () => {
    const c = await signIn();
    const created = await post(c, RESUMES, { title: 'Guard' }).expect(201);
    // A guard that fires on ordinary prose is one people learn to work around.
    await c.agent
      .patch(`${RESUMES}/${created.body.data.resume.id as string}`)
      .set('X-CSRF-Token', c.csrf)
      .send({
        content: {
          ...created.body.data.resume.content,
          summary: 'Maintained the parser [sic] between [2020-2024].',
        },
      })
      .expect(200);
  });
});
