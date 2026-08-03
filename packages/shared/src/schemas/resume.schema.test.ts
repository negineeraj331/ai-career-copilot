import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dateRangeSchema, emptyResumeDocument, resumeDocumentSchema } from './resume.schema.js';
import { RESUME_SCHEMA_VERSION } from '../constants/index.js';

describe('dateRangeSchema', () => {
  it('accepts an open-ended range', () => {
    expect(dateRangeSchema.parse({ start: '2024-01', end: null }).end).toBeNull();
  });

  it('rejects an end date before the start date', () => {
    const result = dateRangeSchema.safeParse({ start: '2024-06', end: '2024-01' });
    expect(result.success).toBe(false);
  });

  it('rejects a month outside 01-12', () => {
    expect(dateRangeSchema.safeParse({ start: '2024-13', end: null }).success).toBe(false);
  });

  it('accepts equal start and end months', () => {
    expect(dateRangeSchema.safeParse({ start: '2024-06', end: '2024-06' }).success).toBe(true);
  });
});

describe('resumeDocumentSchema', () => {
  it('fills every collection with a default so consumers never see undefined', () => {
    const doc = emptyResumeDocument('Aditi Sharma', 'aditi@example.com');
    expect(doc.experience).toEqual([]);
    expect(doc.skills).toEqual([]);
    expect(doc.sections.order.length).toBeGreaterThan(0);
    expect(doc.schemaVersion).toBe(RESUME_SCHEMA_VERSION);
  });

  it('normalises the contact email', () => {
    const doc = emptyResumeDocument('Aditi', '  Aditi@Example.COM ');
    expect(doc.contact.email).toBe('aditi@example.com');
  });

  it('rejects a document declaring a different schema version', () => {
    const doc = emptyResumeDocument('Aditi', 'aditi@example.com');
    const result = resumeDocumentSchema.safeParse({ ...doc, schemaVersion: 99 });
    expect(result.success).toBe(false);
  });

  it('requires a stable id on every array entry', () => {
    const doc = emptyResumeDocument('Aditi', 'aditi@example.com');
    const withoutId = {
      ...doc,
      experience: [
        {
          company: 'Acme',
          role: 'SDE',
          dates: { start: '2024-01', end: null },
          bullets: [],
          technologies: [],
        },
      ],
    };
    // Without an id, diffs and comment anchors could not survive a reorder.
    expect(resumeDocumentSchema.safeParse(withoutId).success).toBe(false);
  });

  it('accepts a fully populated experience entry', () => {
    const doc = emptyResumeDocument('Aditi', 'aditi@example.com');
    const result = resumeDocumentSchema.safeParse({
      ...doc,
      experience: [
        {
          id: randomUUID(),
          company: 'Acme',
          role: 'Backend Engineer',
          dates: { start: '2024-01', end: null },
          bullets: [{ id: randomUUID(), text: 'Built an API.' }],
          technologies: ['Node.js'],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
