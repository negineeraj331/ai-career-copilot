import { z } from 'zod';
import { LIMITS } from '../constants/index.js';
import { isoDateTimeSchema, uuidSchema } from './common.schema.js';

/** Job descriptions are untrusted text pasted from the open internet. They are
 *  stored verbatim, parsed into this structure by the AI layer, and every parsed
 *  field is schema-validated before anything acts on it. docs/11 §11. */

export const createJobDescriptionSchema = z.object({
  title: z.string().trim().max(160).optional(),
  company: z.string().trim().max(160).optional(),
  sourceUrl: z.url().optional(),
  rawText: z
    .string()
    .trim()
    .min(LIMITS.JD_MIN, 'Paste the full description — short text produces unreliable matches.')
    .max(LIMITS.JD_MAX),
});
export type CreateJobDescriptionInput = z.infer<typeof createJobDescriptionSchema>;

export const SKILL_IMPORTANCE = ['REQUIRED', 'PREFERRED'] as const;
export const skillImportanceSchema = z.enum(SKILL_IMPORTANCE);
export type SkillImportance = z.infer<typeof skillImportanceSchema>;

export const skillRequirementSchema = z.object({
  name: z.string().trim().min(1).max(60),
  importance: skillImportanceSchema,
  /** Relative weight within the JD, 0–1. Drives the ranking of missing skills. */
  weight: z.number().min(0).max(1),
  /** Where in the JD this was found — lets the UI show the evidence. */
  evidence: z.string().trim().max(400).optional(),
});
export type SkillRequirement = z.infer<typeof skillRequirementSchema>;

export const SENIORITY_LEVELS = [
  'INTERN',
  'ENTRY',
  'JUNIOR',
  'MID',
  'SENIOR',
  'STAFF',
  'PRINCIPAL',
  'UNSPECIFIED',
] as const;
export const senioritySchema = z.enum(SENIORITY_LEVELS);
export type Seniority = z.infer<typeof senioritySchema>;

export const EDUCATION_REQUIREMENTS = [
  'NONE',
  'DIPLOMA',
  'BACHELORS',
  'MASTERS',
  'DOCTORATE',
  'UNSPECIFIED',
] as const;
export const educationRequirementSchema = z.enum(EDUCATION_REQUIREMENTS);

/**
 * The structured output contract for `jd.extract`. This doubles as the JSON
 * schema sent to the model, so every field must be expressible in the subset of
 * JSON Schema that structured outputs support — no `minLength`, no recursion.
 */
export const parsedJobDescriptionSchema = z.object({
  roleTitle: z.string().trim().max(160),
  seniority: senioritySchema,
  requiredSkills: z.array(skillRequirementSchema).max(60),
  preferredSkills: z.array(skillRequirementSchema).max(60),
  minYearsExperience: z.number().min(0).max(50).nullable(),
  educationRequirement: educationRequirementSchema,
  responsibilities: z.array(z.string().trim().max(400)).max(30),
  /** Signals like "remote-first", "Series B", "on-call rotation" — used for
   *  cover-letter personalisation, never for scoring. */
  companySignals: z.array(z.string().trim().max(200)).max(15),
});
export type ParsedJobDescription = z.infer<typeof parsedJobDescriptionSchema>;

export const jobDescriptionSummarySchema = z.object({
  id: uuidSchema,
  title: z.string().nullable(),
  company: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  parsedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type JobDescriptionSummary = z.infer<typeof jobDescriptionSummarySchema>;

export const jobDescriptionDetailSchema = jobDescriptionSummarySchema.extend({
  rawText: z.string(),
  parsed: parsedJobDescriptionSchema.nullable(),
});
export type JobDescriptionDetail = z.infer<typeof jobDescriptionDetailSchema>;
