import { z } from 'zod';
import {
  DEFAULT_TEMPLATE_ID,
  LIMITS,
  RESUME_SCHEMA_VERSION,
  TEMPLATE_IDS,
} from '../constants/index.js';
import { emailSchema, isoDateTimeSchema, monthSchema, uuidSchema } from './common.schema.js';

/**
 * The resume is data, not a document (ADR-005). Everything downstream — scoring,
 * diffing, exports, portfolio generation — depends on this structure.
 *
 * Every array item carries a stable `id`, so a reorder does not invalidate diffs,
 * comment anchors, or AI suggestion targets. That single field is what makes
 * version history and anchored comments possible at all.
 */

const entryId = uuidSchema;

/** A date range that may still be running. `null` end = "Present". */
export const dateRangeSchema = z
  .object({
    start: monthSchema,
    end: monthSchema.nullable(),
  })
  .refine((r) => r.end === null || r.end >= r.start, {
    message: 'End date must not be before the start date.',
    path: ['end'],
  });
export type DateRange = z.infer<typeof dateRangeSchema>;

export const contactSchema = z.object({
  fullName: z.string().trim().min(1).max(LIMITS.NAME_MAX),
  headline: z.string().trim().max(200).optional(),
  email: emailSchema,
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(120).optional(),
  links: z
    .array(
      z.object({
        id: entryId,
        label: z.string().trim().min(1).max(40),
        url: z.url(),
      }),
    )
    .max(8)
    .default([]),
});
export type Contact = z.infer<typeof contactSchema>;

export const bulletSchema = z.object({
  id: entryId,
  text: z.string().trim().min(1).max(LIMITS.BULLET_MAX),
});
export type Bullet = z.infer<typeof bulletSchema>;

export const experienceSchema = z.object({
  id: entryId,
  company: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).optional(),
  employmentType: z
    .enum(['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'FREELANCE'])
    .optional(),
  dates: dateRangeSchema,
  bullets: z.array(bulletSchema).max(12).default([]),
  technologies: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});
export type Experience = z.infer<typeof experienceSchema>;

export const educationSchema = z.object({
  id: entryId,
  institution: z.string().trim().min(1).max(160),
  degree: z.string().trim().min(1).max(120),
  field: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  dates: dateRangeSchema,
  /** Free text, not a number: GPA scales differ by country (4.0, 10.0, %, class). */
  grade: z.string().trim().max(40).optional(),
  highlights: z.array(bulletSchema).max(6).default([]),
});
export type Education = z.infer<typeof educationSchema>;

export const projectSchema = z.object({
  id: entryId,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional(),
  url: z.url().optional(),
  repoUrl: z.url().optional(),
  dates: dateRangeSchema.optional(),
  bullets: z.array(bulletSchema).max(8).default([]),
  technologies: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});
export type Project = z.infer<typeof projectSchema>;

/** Grouped rather than flat: "Languages: Go, TypeScript" parses better in ATS
 *  keyword extraction than an undifferentiated list, and reads better to a human. */
export const skillGroupSchema = z.object({
  id: entryId,
  category: z.string().trim().min(1).max(60),
  skills: z.array(z.string().trim().min(1).max(40)).min(1).max(40),
});
export type SkillGroup = z.infer<typeof skillGroupSchema>;

export const certificationSchema = z.object({
  id: entryId,
  name: z.string().trim().min(1).max(160),
  issuer: z.string().trim().max(120).optional(),
  issuedAt: monthSchema.optional(),
  expiresAt: monthSchema.optional(),
  credentialUrl: z.url().optional(),
});
export type Certification = z.infer<typeof certificationSchema>;

export const achievementSchema = z.object({
  id: entryId,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(400).optional(),
  date: monthSchema.optional(),
});
export type Achievement = z.infer<typeof achievementSchema>;

export const customSectionSchema = z.object({
  id: entryId,
  title: z.string().trim().min(1).max(80),
  items: z.array(bulletSchema).max(20).default([]),
});
export type CustomSection = z.infer<typeof customSectionSchema>;

export const SECTION_KEYS = [
  'summary',
  'experience',
  'education',
  'projects',
  'skills',
  'certifications',
  'achievements',
] as const;
export const sectionKeySchema = z.enum(SECTION_KEYS);
export type SectionKey = z.infer<typeof sectionKeySchema>;

/** Presentation state lives with the document so a restored version renders
 *  exactly as it did — order and visibility are part of what the user chose. */
export const sectionSettingsSchema = z.object({
  order: z.array(z.string()).default([...SECTION_KEYS]),
  hidden: z.array(z.string()).default([]),
});

export const resumeDocumentSchema = z.object({
  schemaVersion: z.literal(RESUME_SCHEMA_VERSION),
  contact: contactSchema,
  summary: z.string().trim().max(LIMITS.SUMMARY_MAX).optional(),
  experience: z.array(experienceSchema).max(20).default([]),
  education: z.array(educationSchema).max(10).default([]),
  projects: z.array(projectSchema).max(20).default([]),
  skills: z.array(skillGroupSchema).max(12).default([]),
  certifications: z.array(certificationSchema).max(20).default([]),
  achievements: z.array(achievementSchema).max(20).default([]),
  customSections: z.array(customSectionSchema).max(6).default([]),
  sections: sectionSettingsSchema.default({ order: [...SECTION_KEYS], hidden: [] }),
});
export type ResumeDocument = z.infer<typeof resumeDocumentSchema>;

export const RESUME_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED', 'AWAITING_CONFIRMATION'] as const;
export const resumeStatusSchema = z.enum(RESUME_STATUSES);
export type ResumeStatus = z.infer<typeof resumeStatusSchema>;

/**
 * Validated against the catalogue, not merely against being a short string.
 *
 * A free-text templateId lets a typo persist to the database and surface later
 * as a resume that renders as nothing. The set of templates the client can draw
 * is known at build time, so the contract may as well say so.
 */
export const templateIdSchema = z
  .string()
  .trim()
  .refine((id) => TEMPLATE_IDS.includes(id), { message: 'Unknown template.' });

export const createResumeSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.RESUME_TITLE_MAX),
  templateId: templateIdSchema.default(DEFAULT_TEMPLATE_ID),
  targetRole: z.string().trim().max(120).optional(),
  content: resumeDocumentSchema.optional(),
});
export type CreateResumeInput = z.infer<typeof createResumeSchema>;

export const updateResumeSchema = z
  .object({
    title: z.string().trim().min(1).max(LIMITS.RESUME_TITLE_MAX).optional(),
    templateId: templateIdSchema.optional(),
    targetRole: z.string().trim().max(120).nullable().optional(),
    content: resumeDocumentSchema.optional(),
    /** Optimistic concurrency. A mismatch returns 409 with the server's current
     *  version, so two open tabs cannot silently overwrite each other. */
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'expectedVersion'), {
    message: 'Provide at least one field to update.',
  });
export type UpdateResumeInput = z.infer<typeof updateResumeSchema>;

export const resumeSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  templateId: z.string(),
  targetRole: z.string().nullable(),
  status: resumeStatusSchema,
  atsScore: z.number().int().min(0).max(100).nullable(),
  currentVersion: z.number().int().positive().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ResumeSummary = z.infer<typeof resumeSummarySchema>;

export const resumeDetailSchema = resumeSummarySchema.extend({
  content: resumeDocumentSchema,
});
export type ResumeDetail = z.infer<typeof resumeDetailSchema>;

export const resumeVersionSchema = z.object({
  id: uuidSchema,
  versionNumber: z.number().int().positive(),
  changeSummary: z.string().nullable(),
  atsScore: z.number().int().min(0).max(100).nullable(),
  createdAt: isoDateTimeSchema,
});
export type ResumeVersion = z.infer<typeof resumeVersionSchema>;

export const EXPORT_FORMATS = ['PDF', 'DOCX', 'JSON', 'MARKDOWN', 'LATEX'] as const;
export const exportFormatSchema = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const exportRequestSchema = z.object({
  format: exportFormatSchema,
  templateId: z.string().trim().min(1).max(60).optional(),
});

/** An empty document, for "create from scratch". Callers supply contact details. */
export function emptyResumeDocument(fullName: string, email: string): ResumeDocument {
  return resumeDocumentSchema.parse({
    schemaVersion: RESUME_SCHEMA_VERSION,
    contact: { fullName, email, links: [] },
  });
}
