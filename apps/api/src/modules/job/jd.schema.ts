import { jsonSchemaFor } from '@cc/ai';
import { parsedJobDescriptionSchema } from '@cc/shared';

/**
 * The JSON Schema sent to the model for `jd.extract`.
 *
 * Derived from the Zod schema that validates the response, rather than written
 * alongside it. The hand-written version drifted twice within an hour — it
 * invented an enum value that did not exist and dropped two that did, then
 * omitted the numeric bounds Zod enforces. Both would have shown up as
 * responses that failed validation after being paid for.
 *
 * See packages/ai/src/json-schema.ts for what "derived" does and does not mean.
 */
export const JD_EXTRACT_JSON_SCHEMA = jsonSchemaFor(parsedJobDescriptionSchema);
