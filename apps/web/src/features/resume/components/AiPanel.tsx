import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AiProposal, ResumeDocument } from '@cc/shared';
import { Button } from '../../../components/ui/Button.js';
import { ApiError } from '../../../lib/api-client.js';
import { resumeApi } from '../api/resume.api.js';
import { ProposalCard } from './ProposalCard.js';

/**
 * Bullet rewriting for the section being edited (docs/09 §4 `AiPanel`).
 *
 * Degrades to an explicit unavailable state rather than disappearing: if the
 * provider is down or the quota is spent, the rest of the editor keeps working
 * and the panel says why. An AI outage must not read as a broken product.
 */
export function AiPanel({
  doc,
  targetRole,
  onApply,
}: {
  doc: ResumeDocument;
  targetRole?: string | undefined;
  onApply: (bulletId: string, text: string) => void;
}): ReactNode {
  const [proposals, setProposals] = useState<AiProposal[]>([]);

  const bullets = doc.experience
    .flatMap((role) => role.bullets)
    .filter((b) => b.text.trim())
    .slice(0, 5);

  const optimise = useMutation({
    mutationFn: () => resumeApi.optimiseBullets(bullets, targetRole),
    onSuccess: (data) => {
      setProposals(data.proposals);
    },
  });

  const quotaSpent = optimise.error instanceof ApiError && optimise.error.code === 'QUOTA_EXCEEDED';
  const unavailable =
    optimise.error instanceof ApiError && optimise.error.code === 'AI_UNAVAILABLE';

  return (
    <section
      aria-label="Writing assistant"
      className="flex flex-col gap-3 rounded-xl border border-[var(--border-hairline)] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Writing assistant</h3>
        <Button
          size="sm"
          variant="secondary"
          loading={optimise.isPending}
          disabled={bullets.length === 0}
          onClick={() => {
            optimise.mutate();
          }}
        >
          Improve bullets
        </Button>
      </div>

      {bullets.length === 0 && (
        <p className="text-xs text-[var(--ink-muted)]">
          Add a bullet to your experience and the assistant can suggest a stronger version.
        </p>
      )}

      {quotaSpent && (
        <p role="status" className="text-xs text-[var(--color-status-warning)]">
          You have used this month&rsquo;s AI actions. They reset on the 1st — everything else in
          the editor still works.
        </p>
      )}

      {unavailable && (
        <p role="status" className="text-xs text-[var(--color-status-serious)]">
          The assistant is unavailable right now. Nothing else is affected; try again shortly.
        </p>
      )}

      {optimise.error && !quotaSpent && !unavailable && (
        <p role="status" className="text-xs text-[var(--color-status-critical)]">
          {optimise.error.message}
        </p>
      )}

      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          onAccept={(text) => {
            onApply(proposal.id.replace(/^bullet:/, ''), text);
            setProposals((current) => current.filter((p) => p.id !== proposal.id));
          }}
          onReject={() => {
            setProposals((current) => current.filter((p) => p.id !== proposal.id));
          }}
        />
      ))}
    </section>
  );
}
