import { pino, type Logger } from 'pino';
import { env } from '../../config/env.js';
import { getContext } from './request-context.js';

/**
 * Structured logging (TR-03).
 *
 * Redaction is configured on the logger, not applied at call sites. A rule that
 * every developer must remember forever is a rule that will eventually be
 * forgotten; a serialiser-level denylist cannot be.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.accessToken',
  '*.refreshToken',
  '*.mfaToken',
  '*.secret',
  '*.secretEnc',
  '*.apiKey',
  '*.recoveryCode',
  '*.recoveryCodes',
  '*.recoveryCodeHashes',
];

function createLogger(): Logger {
  const { LOG_LEVEL, NODE_ENV } = env();

  return pino({
    level: NODE_ENV === 'test' ? 'silent' : LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Emit `level: "info"` rather than `level: 30`. Numeric levels are compact
    // but force every human and every log query to carry a lookup table.
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Bind the request context onto every line automatically, so a log
    // statement in a service never has to know about request IDs.
    mixin() {
      const context = getContext();
      if (!context) return {};
      return {
        requestId: context.requestId,
        ...(context.userId ? { userId: context.userId } : {}),
      };
    },
    // Pretty output locally; raw JSON everywhere a log aggregator will read it.
    ...(NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

let instance: Logger | undefined;

export function logger(): Logger {
  instance ??= createLogger();
  return instance;
}

/** A child logger tagged with its origin, e.g. `logger.for('auth.service')`. */
export function loggerFor(module: string): Logger {
  return logger().child({ module });
}
