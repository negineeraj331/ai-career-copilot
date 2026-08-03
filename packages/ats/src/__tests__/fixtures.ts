import { RESUME_SCHEMA_VERSION, type ResumeDocument } from '@cc/shared';

/**
 * Fixtures built by composition rather than by copy-paste, so a test that cares
 * about one rule changes exactly one thing and the reader can see what it is.
 */

let counter = 0;
/** Deterministic ids. The engine is pure and its tests must be too. */
function id(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

export function bullet(text: string) {
  return { id: id(), text };
}

export function emptyDoc(): ResumeDocument {
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    contact: { fullName: 'Aditi Sharma', email: 'aditi@example.com', links: [] },
    experience: [],
    education: [],
    projects: [],
    skills: [],
    certifications: [],
    achievements: [],
    customSections: [],
    sections: {
      order: [
        'summary',
        'experience',
        'education',
        'projects',
        'skills',
        'certifications',
        'achievements',
      ],
      hidden: [],
    },
  };
}

/** A deliberately strong resume — the upper end the rubric should reward. */
export function strongDoc(): ResumeDocument {
  return {
    ...emptyDoc(),
    contact: {
      fullName: 'Aditi Sharma',
      headline: 'Backend Engineer — distributed systems',
      email: 'aditi@example.com',
      phone: '+91 98765 43210',
      location: 'Bengaluru, India',
      links: [
        { id: id(), label: 'GitHub', url: 'https://github.com/aditi' },
        { id: id(), label: 'LinkedIn', url: 'https://linkedin.com/in/aditi' },
      ],
    },
    summary:
      'Backend engineer with five years building payment infrastructure at scale. Cut settlement latency by 60 percent across a system handling 40 million transactions a month, and led the migration that made it possible.',
    experience: [
      {
        id: id(),
        company: 'Razorpay',
        role: 'Senior Backend Engineer',
        location: 'Bengaluru',
        employmentType: 'FULL_TIME',
        dates: { start: '2022-04', end: null },
        bullets: [
          bullet(
            'Reduced p95 settlement latency from 800 ms to 120 ms by replacing a synchronous ledger write with an append-only event log.',
          ),
          bullet(
            'Led the migration of 40 million monthly transactions onto the new pipeline across three teams with zero customer-visible downtime.',
          ),
          bullet(
            'Built the reconciliation service that detects settlement drift within 5 minutes, replacing a nightly batch that took 9 hours.',
          ),
          bullet(
            'Mentored 4 engineers through their first on-call rotation and wrote the runbooks the team still uses today.',
          ),
        ],
        technologies: ['Go', 'PostgreSQL', 'Kafka', 'Kubernetes'],
      },
      {
        id: id(),
        company: 'Freshworks',
        role: 'Backend Engineer',
        location: 'Chennai',
        employmentType: 'FULL_TIME',
        dates: { start: '2020-06', end: '2022-03' },
        bullets: [
          bullet(
            'Designed the multi-tenant rate limiter that cut abusive traffic by 85 percent without a single false positive in production.',
          ),
          bullet(
            'Automated the deployment pipeline, taking release time from 45 minutes of manual steps to 6 minutes of reviewed CI.',
          ),
          bullet(
            'Instrumented the API tier with structured logging and traces, cutting mean time to diagnose an incident from hours to under 20 minutes.',
          ),
        ],
        technologies: ['Python', 'Redis', 'Docker'],
      },
    ],
    education: [
      {
        id: id(),
        institution: 'Lovely Professional University',
        degree: 'B.Tech',
        field: 'Computer Science',
        location: 'Punjab',
        dates: { start: '2016-08', end: '2020-05' },
        grade: '8.4 CGPA',
        highlights: [],
      },
    ],
    projects: [
      {
        id: id(),
        name: 'ledger-lite',
        description: 'An embeddable double-entry ledger with deterministic replay.',
        url: 'https://github.com/aditi/ledger-lite',
        dates: { start: '2023-01', end: '2023-08' },
        bullets: [
          bullet(
            'Implemented deterministic replay over 2 million recorded events, making every historical balance reproducible from the log alone.',
          ),
          bullet(
            'Benchmarked and optimised the write path to sustain 12000 entries per second on a single node.',
          ),
        ],
        technologies: ['Rust', 'SQLite'],
      },
    ],
    skills: [
      { id: id(), category: 'Languages', skills: ['Go', 'Python', 'Rust', 'SQL'] },
      {
        id: id(),
        category: 'Infrastructure',
        skills: ['Kubernetes', 'Kafka', 'PostgreSQL', 'Redis'],
      },
      { id: id(), category: 'Practice', skills: ['Testing', 'Code review', 'Monitoring'] },
    ],
  };
}

/** A deliberately weak resume — every rule family should have something to say. */
export function weakDoc(): ResumeDocument {
  return {
    ...emptyDoc(),
    contact: { fullName: 'A Candidate', email: 'a@example.com', links: [] },
    summary: 'I am a hard worker and a team player.',
    experience: [
      {
        id: id(),
        company: 'Someplace',
        role: 'Developer',
        dates: { start: '2021-01', end: '2023-01' },
        bullets: [
          bullet('Responsible for the backend'),
          bullet('I worked on various tasks'),
          bullet('Helped the team'),
        ],
        technologies: [],
      },
    ],
    skills: [{ id: id(), category: 'Skills', skills: ['Java', 'Excel'] }],
  };
}
