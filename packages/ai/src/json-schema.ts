import { z } from 'zod';

/**
 * Derives the JSON Schema sent to the model from the Zod schema that validates
 * the response.
 *
 * The first version of this was hand-written, on the reasoning that structured
 * outputs accept only a subset of JSON Schema and a generator would emit
 * constructs the provider rejects. That reasoning was sound and the consequence
 * was still worse: two schemas drifted apart twice within an hour. The
 * hand-written one invented an enum value that did not exist (`PHD`) and
 * dropped two that did, then omitted the numeric bounds Zod enforces — so the
 * model would have been told the wrong allowed values and, roughly a third of
 * the time, produced a response that failed validation *after* being paid for.
 *
 * Generating and then normalising keeps the guarantee that made hand-writing
 * attractive — the output stays inside the supported subset — without the
 * duplication that made it dangerous. There is now one source of truth, and it
 * is the one that also validates the answer.
 */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>;
  return normalise(generated) as Record<string, unknown>;
}

function normalise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalise);
  if (node === null || typeof node !== 'object') return node;

  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    // Draft metadata is noise to the provider and only makes the prompt longer.
    if (key === '$schema' || key === 'id' || key === '$id') continue;
    out[key] = normalise(value);
  }

  // `anyOf: [{type: 'number'}, {type: 'null'}]` is how Zod expresses a nullable
  // field. Collapsing it to `type: ['number', 'null']` says the same thing in a
  // form every structured-output implementation accepts, and keeps any sibling
  // constraints (minimum, maximum) that the anyOf branch carried.
  const anyOf = out.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const branches = anyOf as Record<string, unknown>[];
    const nullBranch = branches.find((b) => b.type === 'null');
    const other = branches.find((b) => b.type !== 'null');
    if (nullBranch && other && typeof other.type === 'string') {
      delete out.anyOf;
      Object.assign(out, other, { type: [other.type, 'null'] });
    }
  }

  // Providers reject an object schema that permits unknown keys, and it is what
  // we want regardless: an extra field is a model inventing structure.
  if (out.type === 'object' && !('additionalProperties' in out)) {
    out.additionalProperties = false;
  }

  return out;
}
