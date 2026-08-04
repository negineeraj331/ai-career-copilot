import { jsonSchemaFor } from '@cc/ai';
import { z } from 'zod';
import { aiProposalSchema, findPlaceholders, type AiProposal } from '@cc/shared';
import { prisma } from '../../core/db/prisma.js';
import { run } from './ai.service.js';
import { usage, type Tier } from './quota.service.js';

/**
 * The write-capable AI features (docs/11 §5).
 *
 * Every one returns a **proposal**, never an applied edit. The user sees what
 * they wrote, what the model suggests, and why, and decides. A feature that
 * silently rewrote someone's resume would be the fastest way to lose their
 * trust in everything else the product says.
 */

/**
 * The model's own response shape.
 *
 * Deliberately not `aiProposalSchema`: the model does not assign ids — we do,
 * so a proposal can be referenced without trusting a string the model invented.
 */
const proposalDraftSchema = z.object({
  before: z.string().nullable(),
  after: z.string().max(600),
  rationale: z.string().max(300),
  confidence: z.number().min(0).max(1),
  placeholders: z.array(z.string().max(60)).max(10),
});

const bulletProposalsSchema = z.object({
  proposals: z.array(proposalDraftSchema).min(1).max(10),
});

const skillSuggestionsSchema = z.object({
  skills: z
    .array(
      z.object({
        name: z.string().max(60),
        evidence: z.string().max(300),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(15),
});

const BULLET_JSON_SCHEMA = jsonSchemaFor(bulletProposalsSchema);
const SKILLS_JSON_SCHEMA = jsonSchemaFor(skillSuggestionsSchema);

async function tierOf(userId: string): Promise<Tier> {
  const { tier } = await prisma().user.findUniqueOrThrow({
    where: { id: userId },
    select: { tier: true },
  });
  return tier as Tier;
}

/**
 * Reconciles what the model *said* it left blank with what it actually left
 * blank.
 *
 * The `placeholders` field is self-reported, and the whole safety mechanism
 * hangs off it: the UI blocks Accept until each entry is confirmed. A model that
 * writes "[X]% faster" and then reports an empty list would slip an unfilled
 * figure straight past the gate. So the text is re-scanned and the union is
 * used — trust the model's list, but verify it.
 */
function reconcilePlaceholders(after: string, reported: string[]): string[] {
  const detected = findPlaceholders(after);
  return [...new Set([...detected, ...reported.filter((p) => after.includes(p))])];
}

export interface ProposalsResponse {
  proposals: AiProposal[];
  quotaRemaining: number;
}

export async function optimiseBullets(params: {
  userId: string;
  bullets: { id: string; text: string }[];
  role?: string | undefined;
}): Promise<ProposalsResponse> {
  const tier = await tierOf(params.userId);

  const input = [
    params.role ? `Target role: ${params.role}` : '',
    'Rewrite each of these resume bullets. Return one proposal per bullet, in the same order.',
    ...params.bullets.map((b, i) => `${String(i + 1)}. ${b.text}`),
  ]
    .filter(Boolean)
    .join('\n');

  const result = await run({
    feature: 'bullet.optimize',
    userId: params.userId,
    tier,
    input,
    schema: bulletProposalsSchema,
    jsonSchema: BULLET_JSON_SCHEMA,
    schemaName: 'bullet_proposals',
    schemaDescription: 'Rewritten resume bullets, one proposal per input bullet.',
  });

  const proposals: AiProposal[] = result.value.proposals.map((draft, index) => {
    const source = params.bullets[index];
    return aiProposalSchema.parse({
      // Our id, keyed to the bullet it belongs to, so the client can apply a
      // proposal without matching on text that may have changed.
      id: `bullet:${source?.id ?? String(index)}`,
      before: draft.before ?? source?.text ?? null,
      after: draft.after,
      rationale: draft.rationale,
      confidence: draft.confidence,
      placeholders: reconcilePlaceholders(draft.after, draft.placeholders),
    });
  });

  const quota = await usage(params.userId, tier);
  return { proposals, quotaRemaining: quota.remaining };
}

export async function generateBullet(params: {
  userId: string;
  rawInput: string;
  role?: string | undefined;
}): Promise<ProposalsResponse> {
  const tier = await tierOf(params.userId);

  const result = await run({
    feature: 'bullet.optimize',
    userId: params.userId,
    tier,
    input: [
      params.role ? `Target role: ${params.role}` : '',
      'Turn the following description of work into a single resume bullet.',
      params.rawInput,
    ]
      .filter(Boolean)
      .join('\n'),
    schema: bulletProposalsSchema,
    jsonSchema: BULLET_JSON_SCHEMA,
    schemaName: 'bullet_proposals',
    schemaDescription: 'A resume bullet written from a plain description of the work.',
  });

  const proposals = result.value.proposals.slice(0, 1).map((draft, index) =>
    aiProposalSchema.parse({
      id: `generated:${String(index)}`,
      before: null,
      after: draft.after,
      rationale: draft.rationale,
      confidence: draft.confidence,
      placeholders: reconcilePlaceholders(draft.after, draft.placeholders),
    }),
  );

  const quota = await usage(params.userId, tier);
  return { proposals, quotaRemaining: quota.remaining };
}

export async function suggestSkills(params: { userId: string; resumeText: string }): Promise<{
  skills: { name: string; evidence: string; confidence: number }[];
  quotaRemaining: number;
}> {
  const tier = await tierOf(params.userId);

  const result = await run({
    feature: 'skill.suggest',
    userId: params.userId,
    tier,
    input: params.resumeText,
    schema: skillSuggestionsSchema,
    jsonSchema: SKILLS_JSON_SCHEMA,
    schemaName: 'skill_suggestions',
    schemaDescription: 'Skills the experience evidences but the resume does not list.',
  });

  const quota = await usage(params.userId, tier);
  return { skills: result.value.skills, quotaRemaining: quota.remaining };
}

export async function quotaFor(userId: string) {
  const tier = await tierOf(userId);
  return usage(userId, tier);
}
