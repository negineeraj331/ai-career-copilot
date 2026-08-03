import type { AuditEvent } from '@cc/shared';
import { prisma } from '../../core/db/prisma.js';
import { loggerFor } from '../../core/logger/logger.js';
import { getContext } from '../../core/logger/request-context.js';

const log = loggerFor('audit');

export interface AuditInput {
  event: AuditEvent;
  userId?: string | null;
  outcome?: 'SUCCESS' | 'FAILURE';
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append an audit entry (FR-11).
 *
 * Never throws. An audit write that fails must not take down the operation it
 * describes — a user should not be unable to log in because the log table is
 * full. The failure is logged loudly instead, so the gap is visible rather
 * than silent.
 *
 * IP and user agent come from the request context rather than being passed in,
 * so no caller can forget them.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  const context = getContext();

  try {
    await prisma().auditLog.create({
      data: {
        userId: input.userId ?? null,
        event: input.event,
        outcome: input.outcome ?? 'SUCCESS',
        ipPrefix: context?.ipPrefix,
        userAgent: input.metadata?.userAgent
          ? String(input.metadata.userAgent).slice(0, 500)
          : null,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata ? (input.metadata as object) : undefined,
      },
    });
  } catch (error) {
    log.error(
      { err: error, event: input.event, userId: input.userId },
      'failed to write audit entry',
    );
  }
}
