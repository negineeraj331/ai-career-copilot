import type { ReactNode } from 'react';
import type { ResumeDocument, SectionKey } from '@cc/shared';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import {
  emptyEducation,
  emptyExperience,
  emptyProject,
  emptySkillGroup,
  newId,
  removeAt,
  setField,
  updateAt,
} from '../lib/document.js';

/**
 * The editing surface for one section.
 *
 * Every change flows up as a whole new document rather than a mutation, because
 * the preview, the score, and the autosave buffer all read the same object —
 * and an in-place edit would leave two of the three showing stale data.
 *
 * docs/09 asks for React Hook Form with uncontrolled inputs so a keystroke
 * re-renders one field. These are controlled instead, deliberately: the live
 * preview and the ATS score are functions of the whole document, so the parent
 * has to re-render on every keystroke regardless. RHF would add a second source
 * of truth and a synchronisation problem without removing the render. Revisit
 * when a section grows past a dozen fields; recorded in docs/tracker.md.
 */

interface FormProps {
  doc: ResumeDocument;
  onChange: (next: ResumeDocument) => void;
  onBlur: () => void;
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder?: string;
  type?: string;
}): ReactNode {
  return (
    <Input
      label={props.label}
      value={props.value}
      type={props.type ?? 'text'}
      placeholder={props.placeholder}
      onChange={(e) => {
        props.onChange(e.target.value);
      }}
      onBlur={props.onBlur}
    />
  );
}

function TextArea(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  rows?: number;
  hint?: string;
}): ReactNode {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-[var(--ink-primary)]">{props.label}</span>
      <textarea
        rows={props.rows ?? 3}
        value={props.value}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
        onBlur={props.onBlur}
        className="w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--ink-primary)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--accent)]"
      />
      {props.hint && <span className="text-xs text-[var(--ink-muted)]">{props.hint}</span>}
    </label>
  );
}

function EntryCard(props: { title: string; onRemove: () => void; children: ReactNode }): ReactNode {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-[var(--border-hairline)] p-4">
      <legend className="flex items-center gap-2 px-1 text-sm font-medium">
        {props.title}
        <button
          type="button"
          onClick={props.onRemove}
          className="text-xs text-[var(--color-status-critical)] underline"
        >
          Remove
        </button>
      </legend>
      {props.children}
    </fieldset>
  );
}

/** A bullet list editor, shared by experience and projects. */
function Bullets(props: {
  bullets: { id: string; text: string }[];
  onChange: (next: { id: string; text: string }[]) => void;
  onBlur: () => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Bullets</span>
      {props.bullets.map((b, i) => (
        <div key={b.id} className="flex items-start gap-2">
          <textarea
            rows={2}
            value={b.text}
            aria-label={`Bullet ${String(i + 1)}`}
            onChange={(e) => {
              props.onChange(updateAt(props.bullets, i, { text: e.target.value }));
            }}
            onBlur={props.onBlur}
            className="w-full rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-card)] px-3 py-2 text-sm"
          />
          <button
            type="button"
            aria-label={`Remove bullet ${String(i + 1)}`}
            onClick={() => {
              props.onChange(removeAt(props.bullets, i));
            }}
            className="mt-2 text-xs text-[var(--color-status-critical)]"
          >
            ✕
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          props.onChange([...props.bullets, { id: newId(), text: '' }]);
        }}
      >
        Add bullet
      </Button>
    </div>
  );
}

function CommaList(props: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  onBlur: () => void;
}): ReactNode {
  return (
    <Field
      label={props.label}
      value={props.value.join(', ')}
      onChange={(v) => {
        // Split on commit, not on every keystroke: filtering empties as the
        // user types would delete the separator the moment they typed it.
        props.onChange(v.split(',').map((s) => s.trimStart()));
      }}
      onBlur={() => {
        props.onChange(props.value.map((s) => s.trim()).filter(Boolean));
        props.onBlur();
      }}
      placeholder="Go, PostgreSQL, Kafka"
    />
  );
}

export function SectionForm({
  section,
  doc,
  onChange,
  onBlur,
}: FormProps & { section: SectionKey }): ReactNode {
  switch (section) {
    case 'summary':
      return (
        <div className="flex flex-col gap-4">
          <Field
            label="Full name"
            value={doc.contact.fullName}
            onChange={(v) => {
              onChange(setField(doc, 'contact', { ...doc.contact, fullName: v }));
            }}
            onBlur={onBlur}
          />
          <Field
            label="Headline"
            value={doc.contact.headline ?? ''}
            placeholder="Backend Engineer — distributed systems"
            onChange={(v) => {
              onChange(setField(doc, 'contact', { ...doc.contact, headline: v }));
            }}
            onBlur={onBlur}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Email"
              type="email"
              value={doc.contact.email}
              onChange={(v) => {
                onChange(setField(doc, 'contact', { ...doc.contact, email: v }));
              }}
              onBlur={onBlur}
            />
            <Field
              label="Phone"
              value={doc.contact.phone ?? ''}
              onChange={(v) => {
                onChange(setField(doc, 'contact', { ...doc.contact, phone: v }));
              }}
              onBlur={onBlur}
            />
          </div>
          <Field
            label="Location"
            value={doc.contact.location ?? ''}
            placeholder="Bengaluru, India"
            onChange={(v) => {
              onChange(setField(doc, 'contact', { ...doc.contact, location: v }));
            }}
            onBlur={onBlur}
          />
          <TextArea
            label="Professional summary"
            rows={4}
            hint="Two or three sentences: what you do, your strongest evidence, what you want next."
            value={doc.summary ?? ''}
            onChange={(v) => {
              onChange(setField(doc, 'summary', v));
            }}
            onBlur={onBlur}
          />
        </div>
      );

    case 'experience':
      return (
        <div className="flex flex-col gap-4">
          {doc.experience.map((role, i) => (
            <EntryCard
              key={role.id}
              title={role.company || `Role ${String(i + 1)}`}
              onRemove={() => {
                onChange(setField(doc, 'experience', removeAt(doc.experience, i)));
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Company"
                  value={role.company}
                  onChange={(v) => {
                    onChange(
                      setField(doc, 'experience', updateAt(doc.experience, i, { company: v })),
                    );
                  }}
                  onBlur={onBlur}
                />
                <Field
                  label="Role"
                  value={role.role}
                  onChange={(v) => {
                    onChange(setField(doc, 'experience', updateAt(doc.experience, i, { role: v })));
                  }}
                  onBlur={onBlur}
                />
                <Field
                  label="Start (YYYY-MM)"
                  value={role.dates.start}
                  onChange={(v) => {
                    onChange(
                      setField(
                        doc,
                        'experience',
                        updateAt(doc.experience, i, { dates: { ...role.dates, start: v } }),
                      ),
                    );
                  }}
                  onBlur={onBlur}
                />
                <Field
                  label="End (YYYY-MM, blank if current)"
                  value={role.dates.end ?? ''}
                  onChange={(v) => {
                    onChange(
                      setField(
                        doc,
                        'experience',
                        updateAt(doc.experience, i, {
                          dates: { ...role.dates, end: v === '' ? null : v },
                        }),
                      ),
                    );
                  }}
                  onBlur={onBlur}
                />
              </div>
              <Bullets
                bullets={role.bullets}
                onChange={(next) => {
                  onChange(
                    setField(doc, 'experience', updateAt(doc.experience, i, { bullets: next })),
                  );
                }}
                onBlur={onBlur}
              />
              <CommaList
                label="Technologies"
                value={role.technologies}
                onChange={(next) => {
                  onChange(
                    setField(
                      doc,
                      'experience',
                      updateAt(doc.experience, i, { technologies: next }),
                    ),
                  );
                }}
                onBlur={onBlur}
              />
            </EntryCard>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onChange(setField(doc, 'experience', [...doc.experience, emptyExperience()]));
            }}
          >
            Add role
          </Button>
        </div>
      );

    case 'education':
      return (
        <div className="flex flex-col gap-4">
          {doc.education.map((entry, i) => (
            <EntryCard
              key={entry.id}
              title={entry.institution || `Education ${String(i + 1)}`}
              onRemove={() => {
                onChange(setField(doc, 'education', removeAt(doc.education, i)));
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Institution"
                  value={entry.institution}
                  onChange={(v) => {
                    onChange(
                      setField(doc, 'education', updateAt(doc.education, i, { institution: v })),
                    );
                  }}
                  onBlur={onBlur}
                />
                <Field
                  label="Degree"
                  value={entry.degree}
                  onChange={(v) => {
                    onChange(setField(doc, 'education', updateAt(doc.education, i, { degree: v })));
                  }}
                  onBlur={onBlur}
                />
                <Field
                  label="Field"
                  value={entry.field ?? ''}
                  onChange={(v) => {
                    onChange(setField(doc, 'education', updateAt(doc.education, i, { field: v })));
                  }}
                  onBlur={onBlur}
                />
                <Field
                  label="Grade"
                  value={entry.grade ?? ''}
                  placeholder="8.4 CGPA"
                  onChange={(v) => {
                    onChange(setField(doc, 'education', updateAt(doc.education, i, { grade: v })));
                  }}
                  onBlur={onBlur}
                />
              </div>
            </EntryCard>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onChange(setField(doc, 'education', [...doc.education, emptyEducation()]));
            }}
          >
            Add education
          </Button>
        </div>
      );

    case 'projects':
      return (
        <div className="flex flex-col gap-4">
          {doc.projects.map((project, i) => (
            <EntryCard
              key={project.id}
              title={project.name || `Project ${String(i + 1)}`}
              onRemove={() => {
                onChange(setField(doc, 'projects', removeAt(doc.projects, i)));
              }}
            >
              <Field
                label="Name"
                value={project.name}
                onChange={(v) => {
                  onChange(setField(doc, 'projects', updateAt(doc.projects, i, { name: v })));
                }}
                onBlur={onBlur}
              />
              <TextArea
                label="Description"
                value={project.description ?? ''}
                onChange={(v) => {
                  onChange(
                    setField(doc, 'projects', updateAt(doc.projects, i, { description: v })),
                  );
                }}
                onBlur={onBlur}
              />
              <Bullets
                bullets={project.bullets}
                onChange={(next) => {
                  onChange(setField(doc, 'projects', updateAt(doc.projects, i, { bullets: next })));
                }}
                onBlur={onBlur}
              />
              <CommaList
                label="Technologies"
                value={project.technologies}
                onChange={(next) => {
                  onChange(
                    setField(doc, 'projects', updateAt(doc.projects, i, { technologies: next })),
                  );
                }}
                onBlur={onBlur}
              />
            </EntryCard>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onChange(setField(doc, 'projects', [...doc.projects, emptyProject()]));
            }}
          >
            Add project
          </Button>
        </div>
      );

    case 'skills':
      return (
        <div className="flex flex-col gap-4">
          {doc.skills.map((group, i) => (
            <EntryCard
              key={group.id}
              title={group.category || `Group ${String(i + 1)}`}
              onRemove={() => {
                onChange(setField(doc, 'skills', removeAt(doc.skills, i)));
              }}
            >
              <Field
                label="Category"
                value={group.category}
                placeholder="Languages"
                onChange={(v) => {
                  onChange(setField(doc, 'skills', updateAt(doc.skills, i, { category: v })));
                }}
                onBlur={onBlur}
              />
              <CommaList
                label="Skills"
                value={group.skills}
                onChange={(next) => {
                  onChange(setField(doc, 'skills', updateAt(doc.skills, i, { skills: next })));
                }}
                onBlur={onBlur}
              />
            </EntryCard>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onChange(setField(doc, 'skills', [...doc.skills, emptySkillGroup()]));
            }}
          >
            Add skill group
          </Button>
        </div>
      );

    default:
      // certifications and achievements have no editor yet; the preview still
      // renders whatever an import put there rather than pretending it is gone.
      return (
        <p className="text-sm text-[var(--ink-muted)]">
          This section has no editor yet. Existing content is preserved and still appears in the
          preview and the score.
        </p>
      );
  }
}
