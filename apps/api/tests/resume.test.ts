import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { closeDatabase, prisma } from '../src/core/db/prisma.js';
import { closeRedis } from '../src/core/redis/client.js';
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
 * Slice 1.1 — the versioned resume.
 *
 * These run against real Postgres. The behaviour under test is largely
 * transactional (append-a-version, coalesce, optimistic concurrency), and a
 * mocked ORM would confirm the code calls the methods it calls rather than that
 * the database ends up in the right state.
 */

const RESUMES = '/api/v1/resumes';

let app: Express;
let client: Client;

const OWNER = 'resume-owner@example.com';
const STRANGER = 'resume-stranger@example.com';
const MANAGED = [OWNER, STRANGER];

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await resetAuthState(MANAGED);
  client = await makeClient(app);
});

afterAll(async () => {
  await resetAuthState(MANAGED);
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

async function createResume(c: Client, title = 'Backend SDE'): Promise<string> {
  const res = await post(c, RESUMES, { title }).expect(201);
  return res.body.data.resume.id as string;
}

/** A minimal valid document, built from whatever the server already returned. */
function editSummary(content: Record<string, unknown>, summary: string): Record<string, unknown> {
  return { ...content, summary };
}

describe('authentication', () => {
  it('refuses every resume endpoint without a session', async () => {
    await get(client, RESUMES).expect(401);
    await post(client, RESUMES, { title: 'x' }).expect(401);
    await get(client, `${RESUMES}/${randomUUID()}`).expect(401);
  });
});

describe('create', () => {
  it('creates a resume with a first version and an empty document', async () => {
    const c = await signIn(OWNER);
    const res = await post(c, RESUMES, { title: 'Backend SDE' }).expect(201);

    const { resume } = res.body.data;
    expect(resume.title).toBe('Backend SDE');
    expect(resume.status).toBe('DRAFT');
    expect(resume.currentVersion).toBe(1);
    expect(resume.atsScore).toBeNull();
    // Seeded from the account, so a new user does not start by retyping their
    // own name and address.
    expect(resume.content.contact.email).toBe(OWNER);
    expect(resume.content.schemaVersion).toBe(1);
  });

  it('defaults the template rather than requiring the client to know one', async () => {
    const c = await signIn(OWNER);
    const res = await post(c, RESUMES, { title: 'x' }).expect(201);
    expect(res.body.data.resume.templateId).toBe('minimal-ats');
  });

  it('rejects a title that is empty or absent', async () => {
    const c = await signIn(OWNER);
    await post(c, RESUMES, {}).expect(400);
    await post(c, RESUMES, { title: '   ' }).expect(400);
  });
});

describe('ownership', () => {
  it("does not let one user read, edit, or delete another user's resume", async () => {
    const owner = await signIn(OWNER);
    const id = await createResume(owner);

    const stranger = await signIn(STRANGER);
    // 404 rather than 403: a 403 confirms the id exists, which is itself a leak.
    await get(stranger, `${RESUMES}/${id}`).expect(404);
    await stranger.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', stranger.csrf)
      .send({ title: 'stolen' })
      .expect(404);
    await del(stranger, `${RESUMES}/${id}`).expect(404);
    await get(stranger, `${RESUMES}/${id}/versions`).expect(404);
  });

  it("keeps one user's list free of another user's resumes", async () => {
    const owner = await signIn(OWNER);
    await createResume(owner, 'Owner resume');

    const stranger = await signIn(STRANGER);
    const res = await get(stranger, RESUMES).expect(200);
    expect(res.body.data.items).toHaveLength(0);
  });
});

describe('versioning', () => {
  it('appends a version when content changes', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    const before = await get(c, `${RESUMES}/${id}`).expect(200);

    const res = await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: editSummary(before.body.data.resume.content, 'Backend engineer.') })
      .expect(200);

    expect(res.body.data.resume.currentVersion).toBe(2);
    expect(res.body.data.resume.content.summary).toBe('Backend engineer.');

    const versions = await get(c, `${RESUMES}/${id}/versions`).expect(200);
    expect(versions.body.data.versions).toHaveLength(2);
    // Newest first — the timeline reads top-down.
    expect(versions.body.data.versions[0].versionNumber).toBe(2);
  });

  it('coalesces a save that changed nothing instead of growing history', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    const before = await get(c, `${RESUMES}/${id}`).expect(200);
    const content = before.body.data.resume.content;

    // Three identical saves, which is exactly what an autosave timer produces
    // when the user stops typing but leaves the tab open.
    for (let i = 0; i < 3; i++) {
      const res = await c.agent
        .patch(`${RESUMES}/${id}`)
        .set('X-CSRF-Token', c.csrf)
        .send({ content })
        .expect(200);
      expect(res.body.data.resume.currentVersion).toBe(1);
    }

    const versions = await get(c, `${RESUMES}/${id}/versions`).expect(200);
    expect(versions.body.data.versions).toHaveLength(1);
  });

  it('coalesces regardless of key order in the submitted document', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    const before = await get(c, `${RESUMES}/${id}`).expect(200);
    const content = before.body.data.resume.content as Record<string, unknown>;

    // Same document, keys reversed — a client that rebuilds an object from
    // form state will not preserve the server's ordering.
    const reordered = Object.fromEntries(Object.entries(content).reverse());

    await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: reordered })
      .expect(200);

    const versions = await get(c, `${RESUMES}/${id}/versions`).expect(200);
    expect(versions.body.data.versions).toHaveLength(1);
  });

  it('never rewrites an existing version', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    const before = await get(c, `${RESUMES}/${id}`).expect(200);
    const original = before.body.data.resume.content;

    const v1 = await prisma().resumeVersion.findFirstOrThrow({
      where: { resumeId: id, versionNumber: 1 },
    });

    await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: editSummary(original, 'Changed.') })
      .expect(200);

    const v1After = await prisma().resumeVersion.findFirstOrThrow({
      where: { resumeId: id, versionNumber: 1 },
    });
    expect(v1After.contentHash).toBe(v1.contentHash);
    expect(v1After.content).toEqual(v1.content);
  });
});

describe('optimistic concurrency', () => {
  it('rejects a stale write and reports the current version', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    const before = await get(c, `${RESUMES}/${id}`).expect(200);
    const content = before.body.data.resume.content;

    // Tab A saves.
    await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: editSummary(content, 'From tab A.'), expectedVersion: 1 })
      .expect(200);

    // Tab B still believes version 1 is current.
    const res = await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: editSummary(content, 'From tab B.'), expectedVersion: 1 })
      .expect(409);

    expect(res.body.error.code).toBe('CONFLICT');
    // Machine-readable, so the editor can offer "reload" without parsing prose.
    expect(res.headers['x-current-version']).toBe('2');

    // And tab B's content did not land.
    const after = await get(c, `${RESUMES}/${id}`).expect(200);
    expect(after.body.data.resume.content.summary).toBe('From tab A.');
    expect(after.body.data.resume.currentVersion).toBe(2);
  });

  it('allows the write when the expected version matches', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    const before = await get(c, `${RESUMES}/${id}`).expect(200);

    await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({
        content: editSummary(before.body.data.resume.content, 'Fresh.'),
        expectedVersion: 1,
      })
      .expect(200);
  });
});

describe('restore', () => {
  it('restores by appending, so nothing after the restored point is lost', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    const first = await get(c, `${RESUMES}/${id}`).expect(200);
    const base = first.body.data.resume.content;

    await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: editSummary(base, 'Version two.') })
      .expect(200);
    await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: editSummary(base, 'Version three.') })
      .expect(200);

    const versions = await get(c, `${RESUMES}/${id}/versions`).expect(200);
    const v2 = versions.body.data.versions.find(
      (v: { versionNumber: number }) => v.versionNumber === 2,
    );

    const restored = await post(c, `${RESUMES}/${id}/versions/${v2.id}/restore`).expect(201);

    // A new version 4 holding version 2's content — not a rollback to 2.
    expect(restored.body.data.resume.currentVersion).toBe(4);
    expect(restored.body.data.resume.content.summary).toBe('Version two.');

    const after = await get(c, `${RESUMES}/${id}/versions`).expect(200);
    expect(after.body.data.versions).toHaveLength(4);
    // Version 3 is still there. This is the whole point of append-only restore.
    expect(
      after.body.data.versions.some((v: { versionNumber: number }) => v.versionNumber === 3),
    ).toBe(true);
  });

  it('does not append when the restored version is already live', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    const versions = await get(c, `${RESUMES}/${id}/versions`).expect(200);
    const v1 = versions.body.data.versions[0];

    await post(c, `${RESUMES}/${id}/versions/${v1.id}/restore`).expect(201);

    const after = await get(c, `${RESUMES}/${id}/versions`).expect(200);
    expect(after.body.data.versions).toHaveLength(1);
  });

  it('refuses a version id belonging to a different resume', async () => {
    const c = await signIn(OWNER);
    const a = await createResume(c, 'A');
    const b = await createResume(c, 'B');

    const bVersions = await get(c, `${RESUMES}/${b}/versions`).expect(200);
    const bVersionId = bVersions.body.data.versions[0].id;

    await get(c, `${RESUMES}/${a}/versions/${bVersionId}`).expect(404);
    await post(c, `${RESUMES}/${a}/versions/${bVersionId}/restore`).expect(404);
  });
});

describe('delete', () => {
  it('soft deletes, hiding the resume while keeping the row', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);

    await del(c, `${RESUMES}/${id}`).expect(204);
    await get(c, `${RESUMES}/${id}`).expect(404);

    const list = await get(c, RESUMES).expect(200);
    expect(list.body.data.items).toHaveLength(0);

    const row = await prisma().resume.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it('answers a second delete the same way as a first, revealing nothing', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    await del(c, `${RESUMES}/${id}`).expect(204);
    await del(c, `${RESUMES}/${id}`).expect(404);
  });
});

describe('duplicate', () => {
  it('copies content into an independent resume', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c, 'Original');
    const before = await get(c, `${RESUMES}/${id}`).expect(200);

    await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: editSummary(before.body.data.resume.content, 'Shared text.') })
      .expect(200);

    const copy = await post(c, `${RESUMES}/${id}/duplicate`).expect(201);
    expect(copy.body.data.resume.title).toBe('Original (copy)');
    expect(copy.body.data.resume.content.summary).toBe('Shared text.');
    // Its own history, starting fresh.
    expect(copy.body.data.resume.currentVersion).toBe(1);

    // Editing the copy must not touch the original.
    await c.agent
      .patch(`${RESUMES}/${copy.body.data.resume.id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: editSummary(before.body.data.resume.content, 'Only the copy.') })
      .expect(200);

    const original = await get(c, `${RESUMES}/${id}`).expect(200);
    expect(original.body.data.resume.content.summary).toBe('Shared text.');
  });
});

describe('list', () => {
  it('orders by most recently updated and paginates', async () => {
    const c = await signIn(OWNER);
    await createResume(c, 'First');
    await createResume(c, 'Second');
    const third = await createResume(c, 'Third');

    const page1 = await get(c, `${RESUMES}?limit=2`).expect(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.pageInfo.hasNextPage).toBe(true);
    expect(page1.body.data.items[0].title).toBe('Third');

    const page2 = await get(
      c,
      `${RESUMES}?limit=2&cursor=${page1.body.data.pageInfo.endCursor}`,
    ).expect(200);
    expect(page2.body.data.items).toHaveLength(1);
    expect(page2.body.data.pageInfo.hasNextPage).toBe(false);
    expect(page2.body.data.items[0].title).toBe('First');

    // No overlap between pages — the bug offset pagination produces.
    const ids = [...page1.body.data.items, ...page2.body.data.items].map(
      (r: { id: string }) => r.id,
    );
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain(third);
  });

  it('moves a resume to the top when it is edited', async () => {
    const c = await signIn(OWNER);
    const first = await createResume(c, 'First');
    await createResume(c, 'Second');

    const before = await get(c, `${RESUMES}/${first}`).expect(200);
    await c.agent
      .patch(`${RESUMES}/${first}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: editSummary(before.body.data.resume.content, 'Touched.') })
      .expect(200);

    const list = await get(c, RESUMES).expect(200);
    expect(list.body.data.items[0].id).toBe(first);
  });
});

describe('validation', () => {
  it('rejects a malformed resume document rather than storing it', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);

    const res = await c.agent
      .patch(`${RESUMES}/${id}`)
      .set('X-CSRF-Token', c.csrf)
      .send({ content: { schemaVersion: 1, contact: { fullName: '', email: 'not-an-email' } } })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an update with no fields at all', async () => {
    const c = await signIn(OWNER);
    const id = await createResume(c);
    await c.agent.patch(`${RESUMES}/${id}`).set('X-CSRF-Token', c.csrf).send({}).expect(400);
  });

  it('rejects a non-uuid id before it reaches the database', async () => {
    const c = await signIn(OWNER);
    await get(c, `${RESUMES}/not-a-uuid`).expect(400);
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const c = await signIn(OWNER);
    await get(c, `${RESUMES}/${randomUUID()}`).expect(404);
  });
});
