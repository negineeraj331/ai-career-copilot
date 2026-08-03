import type { ResumeDocument } from '@cc/shared';

/**
 * A durable queue for edits made while offline (docs/10 §6).
 *
 * The requirement is that closing the tab mid-outage does not lose work, so
 * this has to outlive the page — an in-memory array would satisfy every test
 * and none of the users. IndexedDB is used directly rather than through a
 * wrapper library: one object store and three operations do not justify the
 * bundle cost, and this file is small enough to read in one sitting.
 *
 * Only the newest pending edit per resume is kept. Autosave produces a stream
 * of snapshots of the same document, so replaying all of them on reconnect
 * would write a version per keystroke-burst and reconstruct exactly the history
 * spam that content-hash coalescing exists to prevent. The last one wins
 * because it already contains every earlier change.
 */

const DB_NAME = 'cc-offline';
const STORE = 'pending-resume-edits';
const DB_VERSION = 1;

export interface PendingEdit {
  resumeId: string;
  content: ResumeDocument;
  expectedVersion: number;
  queuedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | undefined;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    // Private browsing modes and some embedded webviews expose `indexedDB` and
    // then refuse to open it. Resolving null rather than rejecting keeps the
    // editor working without a durable queue instead of breaking outright.
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'resumeId' });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      resolve(null);
    };
    request.onblocked = () => {
      resolve(null);
    };
  });

  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const request = work(tx.objectStore(STORE));
          request.onsuccess = () => {
            resolve(request.result);
          };
          request.onerror = () => {
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      }),
  );
}

export const offlineQueue = {
  /** Replaces any earlier pending edit for the same resume. */
  put: (edit: PendingEdit): Promise<unknown> =>
    run('readwrite', (store) => store.put(edit) as IDBRequest<IDBValidKey>),

  get: (resumeId: string): Promise<PendingEdit | null> =>
    run('readonly', (store) => store.get(resumeId) as IDBRequest<PendingEdit | undefined>).then(
      (v) => v ?? null,
    ),

  all: (): Promise<PendingEdit[]> =>
    run('readonly', (store) => store.getAll() as IDBRequest<PendingEdit[]>).then((v) => v ?? []),

  remove: (resumeId: string): Promise<unknown> =>
    run('readwrite', (store) => store.delete(resumeId) as IDBRequest<undefined>),
};
