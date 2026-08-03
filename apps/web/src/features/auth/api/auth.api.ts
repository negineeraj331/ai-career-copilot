import type { AuditLogEntry, DeviceSession, OAuthProvider, PublicUser } from '@cc/shared';
import { apiClient } from '../../../lib/api-client.js';

/** Typed calls to /auth. Shapes come from @cc/shared, so a contract change
 *  breaks the build on both sides rather than at runtime on one. */

export interface LoginResponse {
  user?: PublicUser;
  mfaRequired: boolean;
  mfaToken?: string;
  expiresIn?: number;
}

export const authApi = {
  register: (body: { email: string; password: string; name?: string }) =>
    apiClient.post<{ message: string; email: string }>('/auth/register', body),

  login: (body: { email: string; password: string; rememberMe: boolean }) =>
    apiClient.post<LoginResponse>('/auth/login', body),

  verifyMfa: (body: { mfaToken: string; code?: string; recoveryCode?: string }) =>
    apiClient.post<LoginResponse>('/auth/mfa/verify', body),

  logout: () => apiClient.post<void>('/auth/logout'),
  logoutAll: () => apiClient.post<void>('/auth/logout-all'),

  me: (signal?: AbortSignal) => apiClient.get<{ user: PublicUser }>('/auth/me', signal),

  verifyEmail: (token: string) =>
    apiClient.post<{ message: string }>('/auth/verify-email', { token }),

  resendVerification: (email: string) =>
    apiClient.post<{ message: string }>('/auth/resend-verification', { email }),

  forgotPassword: (email: string) =>
    apiClient.post<{ message: string }>('/auth/forgot-password', { email }),

  resetPassword: (body: { token: string; password: string }) =>
    apiClient.post<{ message: string }>('/auth/reset-password', body),

  requestMagicLink: (email: string) =>
    apiClient.post<{ message: string }>('/auth/magic-link', { email }),

  verifyMagicLink: (token: string) =>
    apiClient.post<LoginResponse>('/auth/magic-link/verify', { token }),

  sessions: () => apiClient.get<{ sessions: DeviceSession[] }>('/auth/sessions'),
  revokeSession: (id: string) => apiClient.delete<void>(`/auth/sessions/${id}`),

  auditLog: () => apiClient.get<{ events: AuditLogEntry[] }>('/auth/audit-log'),

  linkedProviders: () => apiClient.get<{ providers: OAuthProvider[] }>('/auth/oauth'),
  unlinkProvider: (provider: string) =>
    apiClient.delete<void>(`/auth/oauth/${provider.toLowerCase()}`),
};
