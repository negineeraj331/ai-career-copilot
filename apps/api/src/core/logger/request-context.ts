import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context, carried implicitly through the call stack.
 *
 * Threading a request ID through every function signature would touch every
 * layer for a purely cross-cutting concern. AsyncLocalStorage keeps it out of
 * the domain code while still making it available to the logger, the error
 * handler, and any outbound call that should propagate it.
 */

export interface RequestContext {
  requestId: string;
  userId?: string;
  ipPrefix?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Attach the authenticated user to the current context.
 *
 * Mutates the active store rather than nesting a new one: authentication runs
 * inside the request scope, and re-running `storage.run` there would create a
 * child scope that ends when the middleware returns — losing the userId for the
 * rest of the request, which is exactly when it is wanted.
 */
export function setContextUser(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}
