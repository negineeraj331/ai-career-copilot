import type {
  AtsRuleResult,
  AtsScore,
  PageInfo,
  ResumeDetail,
  ResumeDocument,
  ResumeSummary,
  ResumeVersion,
} from '@cc/shared';
import { apiClient } from '../../../lib/api-client.js';

/** Typed calls to /resumes and /ats. Shapes come from @cc/shared, so a contract
 *  change breaks the build on both sides rather than at runtime on one. */

export interface AtsScoreResult extends AtsScore {
  topFixes: AtsRuleResult[];
}

export const resumeApi = {
  list: (signal?: AbortSignal) =>
    apiClient.get<{ items: ResumeSummary[]; pageInfo: PageInfo }>('/resumes?limit=50', signal),

  get: (id: string, signal?: AbortSignal) =>
    apiClient.get<{ resume: ResumeDetail }>(`/resumes/${id}`, signal),

  create: (body: { title: string; targetRole?: string }) =>
    apiClient.post<{ resume: ResumeDetail }>('/resumes', body),

  update: (
    id: string,
    body: {
      title?: string;
      targetRole?: string | null;
      content?: ResumeDocument;
      expectedVersion?: number;
    },
  ) => apiClient.patch<{ resume: ResumeDetail }>(`/resumes/${id}`, body),

  remove: (id: string) => apiClient.delete<void>(`/resumes/${id}`),

  duplicate: (id: string) => apiClient.post<{ resume: ResumeDetail }>(`/resumes/${id}/duplicate`),

  versions: (id: string, signal?: AbortSignal) =>
    apiClient.get<{ versions: ResumeVersion[] }>(`/resumes/${id}/versions`, signal),

  restore: (id: string, versionId: string) =>
    apiClient.post<{ resume: ResumeDetail }>(`/resumes/${id}/versions/${versionId}/restore`),

  /**
   * Scores a document that has not been saved. The editor uses this rather than
   * the stored score so the number tracks what the user is looking at, not what
   * they last saved.
   */
  scoreDraft: (content: ResumeDocument, targetRole?: string) =>
    apiClient.post<AtsScoreResult>('/ats/score', {
      content,
      ...(targetRole ? { targetRole } : {}),
    }),
};
