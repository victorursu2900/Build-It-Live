/** Preserve the last mesh-only STL across full-page navigation.
 * localStorage is too small for real STL buffers, so use IndexedDB.
 * This cache is limited to the current digital workspace; it never changes
 * or embeds anything into the user's original STL.
 */
const DB_NAME = 'build-it-live-imported-mesh-v1';
const STORE_NAME = 'workspace';
const ACTIVE_KEY = 'digital';

export type StoredMeshSession = {
  buffer: ArrayBuffer;
  id: string;
  gridSize: number;
  gridWidth: number;
  gridDepth: number;
};

function openMeshDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Mesh database is blocked'));
  });
}

export async function saveImportedMeshSession(session: StoredMeshSession): Promise<boolean> {
  let db: IDBDatabase | null = null;
  try {
    db = await openMeshDatabase();
    if (!db) return false;
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const finished = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
    transaction.objectStore(STORE_NAME).put(session, ACTIVE_KEY);
    await finished;
    return true;
  } catch (error) {
    console.warn('Could not cache imported STL:', error);
    return false;
  } finally {
    db?.close();
  }
}

export async function loadImportedMeshSession(): Promise<StoredMeshSession | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openMeshDatabase();
    if (!db) return null;
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(ACTIVE_KEY);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('Could not restore imported STL:', error);
    return null;
  } finally {
    db?.close();
  }
}

export async function clearImportedMeshSession(): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openMeshDatabase();
    if (!db) return;
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const finished = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
    transaction.objectStore(STORE_NAME).delete(ACTIVE_KEY);
    await finished;
  } catch (error) {
    console.warn('Could not clear imported STL cache:', error);
  } finally {
    db?.close();
  }
}
