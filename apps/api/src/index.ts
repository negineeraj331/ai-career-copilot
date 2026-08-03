// Marks this file as a module. With every import now dynamic, TypeScript would
// otherwise treat it as a classic script, where top-level `await` is invalid.
export {};

/**
 * Load .env in development only, and dynamically.
 *
 * A production container takes its configuration from the orchestrator, never
 * from a file baked into the image — so dotenv is a dev dependency and is not
 * present in the production tree at all. A static top-level import therefore
 * crashed the container on startup with ERR_MODULE_NOT_FOUND before a single
 * line of the app ran. Guarding on NODE_ENV keeps local development working
 * while leaving production untouched; the catch covers the case where the
 * package is simply absent.
 */
if (process.env.NODE_ENV !== 'production') {
  try {
    const { config: loadDotenv } = await import('dotenv');
    loadDotenv({ path: ['../../.env', '.env'], quiet: true });
  } catch {
    // No dotenv installed — configuration must already be in the environment.
  }
}

const { loadEnv } = await import('./config/env.js');

// Validate configuration before anything else is constructed. A service must
// never start half-configured (TR-01).
let config: Awaited<ReturnType<typeof loadEnv>>;
try {
  config = loadEnv();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const { createApp } = await import('./app.js');
const { logger } = await import('./core/logger/logger.js');
const { closeDatabase } = await import('./core/db/prisma.js');
const { closeRedis } = await import('./core/redis/client.js');

const log = logger();
const app = createApp();

const server = app.listen(config.PORT, () => {
  log.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening');
});

/**
 * Graceful shutdown (TR-10): stop accepting, finish in-flight requests, close
 * pools, exit. The timer is the important half — a connection that never closes
 * would otherwise hold the process open past any orchestrator's patience, and
 * `unref()` keeps that timer from itself delaying a clean exit.
 */
const SHUTDOWN_TIMEOUT_MS = 30_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    log.error('shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(() => {
    void (async () => {
      try {
        await Promise.all([closeDatabase(), closeRedis()]);
        log.info('shutdown complete');
        process.exit(0);
      } catch (error) {
        log.error({ err: error }, 'error during shutdown');
        process.exit(1);
      }
    })();
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// An unhandled rejection leaves the process in an unknown state. Log it with
// full context, then shut down cleanly rather than limping on.
process.on('unhandledRejection', (reason) => {
  log.fatal({ err: reason }, 'unhandled rejection');
  void shutdown('unhandledRejection');
});
process.on('uncaughtException', (error) => {
  log.fatal({ err: error }, 'uncaught exception');
  void shutdown('uncaughtException');
});
