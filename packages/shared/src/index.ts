/**
 * @cc/shared — the contract between the API and the web client.
 *
 * Every schema here is used on both sides: the API validates requests against it,
 * and the web client validates forms against the same object. A validation rule
 * therefore cannot drift between the two — there is only one of it.
 */

export * from './constants/index.js';
export * from './schemas/common.schema.js';
export * from './schemas/auth.schema.js';
export * from './schemas/resume.schema.js';
export * from './schemas/job.schema.js';
export * from './schemas/analysis.schema.js';
export * from './schemas/placeholders.js';
