/**
 * Durable Recent Models archive for both builders.
 *
 * IndexedDB is the authoritative on-device library. The engine maintains a
 * small synchronous localStorage cache for first paint and compatibility with
 * pre-V82 builds. This library never silently prunes older projects.
 * Browser storage is origin/profile-specific and may still be erased when users
 * clear site data; downloaded .BIL files remain the portable backup.
 */
const DB_NAME = 'build-it-live-project-library-v1';
const STORE = 'models';

type StoredModel = {
  id: string;
  savedAt?: string;
  [key: string]: unknown;
};

type VaultRow = { key: string; mode: string; project: StoredModel };

let operations: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = operations.catch(() => undefined).then(operation);
  operations = next;
  return next;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Project database blocked by another tab'));
  });
}

async function withStore<T>(mode: 'readonly' | 'readwrite', callback: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const database = await openDatabase();
  if (!database) return undefined;
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      let result: T | undefined;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      try {
        const request = callback(transaction.objectStore(STORE));
        if (request) {
          request.onsuccess = () => { result = request.result; };
        }
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}

function key(mode: string, id: string): string {
  return `${mode}:${id}`;
}

function sorted(models: StoredModel[]): StoredModel[] {
  return models.sort((a, b) => Date.parse(b.savedAt || '') - Date.parse(a.savedAt || '') || 0);
}

/** Merge the legacy localStorage list into the archive without losing records
 * that were already archived in a previous session. */
export function restoreRecentModelVault(mode: string, localModels: StoredModel[]): Promise<StoredModel[]> {
  return enqueue(async () => {
    try {
      const rows = await withStore<VaultRow[]>('readonly', store => store.getAll());
      if (!rows) return localModels;
      const merged = new Map<string, StoredModel>();
      for (const row of rows) {
        if (row.mode === mode && row.project?.id) merged.set(String(row.project.id), row.project);
      }
      // localStorage is the recent synchronous cache; its records win on a tie
      // so a just-renamed model isn't reverted after a pending write.
      for (const model of localModels) {
        if (model?.id) {
          const older = merged.get(String(model.id));
          if (!older || Date.parse(model.savedAt || '') >= Date.parse(older.savedAt || '')) {
            merged.set(String(model.id), model);
          }
        }
      }
      const models = sorted([...merged.values()]);
      if (models.length) {
        await withStore('readwrite', store => {
          for (const project of models) store.put({ key: key(mode, String(project.id)), mode, project });
        });
      }
      return models;
    } catch (error) {
      console.warn('Project library could not be restored:', error);
      return localModels;
    }
  });
}

/** Queue a complete set of upserts. Never delete missing IDs implicitly. */
export function archiveRecentModels(mode: string, models: StoredModel[]): Promise<boolean> {
  const snapshot = structuredClone(models);
  return enqueue(async () => {
    try {
      const database = await openDatabase();
      if (!database) return false;
      database.close();
      await withStore('readwrite', store => {
        for (const project of snapshot) {
          if (project?.id) store.put({ key: key(mode, String(project.id)), mode, project });
        }
      });
      return true;
    } catch (error) {
      console.warn('Could not archive recent projects:', error);
      return false;
    }
  });
}

export function eraseRecentModel(mode: string, id: string): Promise<boolean> {
  return enqueue(async () => {
    try {
      await withStore('readwrite', store => { store.delete(key(mode, id)); });
      return true;
    } catch (error) {
      console.warn('Could not delete archived project:', error);
      return false;
    }
  });
}

export function eraseAllRecentModels(mode: string): Promise<boolean> {
  return enqueue(async () => {
    try {
      const rows = await withStore<VaultRow[]>('readonly', store => store.getAll());
      await withStore('readwrite', store => {
        for (const row of rows ?? []) if (row.mode === mode) store.delete(row.key);
      });
      return true;
    } catch (error) {
      console.warn('Could not clear archived projects:', error);
      return false;
    }
  });
}

/** Best effort, requested only from an explicit Save Project gesture. */
export async function requestDurableBrowserStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}


/** Return all saved entries across Hardware and Digital Builder. */
export function listEntireProjectLibrary(): Promise<Array<{mode: 'hardware' | 'digital'; project: StoredModel}>> {
  return enqueue(async () => {
    const rows = await withStore<VaultRow[]>('readonly', store => store.getAll());
    return (rows ?? []).filter(row => ['hardware','digital'].includes(row.mode) && row.project?.id)
      .map(row => ({mode: row.mode as 'hardware'|'digital', project: row.project}));
  });
}

/** Import as additional models; do not overwrite existing IDs. */
export function importProjectLibrary(entries: Array<{mode:'hardware'|'digital';project:StoredModel}>): Promise<{added:number;skipped:number}> {
  return enqueue(async () => {
    const database = await openDatabase();
    if (!database) throw new Error('IndexedDB is unavailable. Library restore requires browser storage.');
    database.close();
    const existing = await withStore<VaultRow[]>('readonly', store => store.getAll()) ?? [];
    const keys = new Set(existing.map(row=>row.key));
    const additions:VaultRow[]=[];
    let skipped = 0;
    for (const row of entries) {
      if (!row?.project?.id || !['hardware','digital'].includes(row.mode)) continue;
      const k = key(row.mode, String(row.project.id));
      if (keys.has(k)) { skipped++; continue; }
      keys.add(k);
      additions.push({key:k,mode:row.mode,project:row.project});
    }
    if (additions.length) await withStore('readwrite', store=>{for(const row of additions)store.put(row);});
    return {added:additions.length, skipped};
  });
}
