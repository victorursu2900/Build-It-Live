import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  archiveRecentModels, restoreRecentModelVault,
  eraseRecentModel, eraseAllRecentModels,
} from '../src/domain/recentModelVault.ts';

const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
const dialog = readFileSync(new URL('../src/components/RecentModelsDialog.tsx', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

function fakeIndexedDb() {
  const rows = new Map();
  const db = {
    objectStoreNames: { contains: () => true },
    close: () => {},
    transaction: () => {
      let pending = 0;
      let ready = false;
      const transaction = {
        oncomplete: null, onerror: null, onabort: null,
        objectStore: () => ({
          getAll: () => request(() => Array.from(rows.values())),
          put: row => request(() => { rows.set(row.key, structuredClone(row)); return row.key; }),
          delete: id => request(() => { rows.delete(id); }),
        }),
      };
      function finish() { if (ready && pending === 0) queueMicrotask(() => transaction.oncomplete?.()); }
      function request(operation) {
        pending++;
        const req = { result: undefined, onsuccess: null };
        queueMicrotask(() => {
          req.result = operation();
          req.onsuccess?.();
          pending--;
          finish();
        });
        return req;
      }
      queueMicrotask(() => { ready = true; finish(); });
      return transaction;
    },
  };
  return {
    rows,
    open: () => {
      const request = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}

test('the Recent Models archive persists 36 distinct projects, preserving builder separation and explicit deletion', async () => {
  const previous = globalThis.indexedDB;
  const indexed = fakeIndexedDb();
  globalThis.indexedDB = indexed;
  try {
    const models = Array.from({ length: 36 }, (_, index) => ({
      id: `project-${index}`, name: `Project ${index}`, savedAt: new Date(2026, 0, 1, 0, index).toISOString(),
      blocks: [{ x: 0, y: 0, z: index % 16, type: 'standard' }],
    }));
    assert.equal(await archiveRecentModels('digital', models), true);
    assert.equal((await restoreRecentModelVault('digital', [])).length, 36);
    assert.equal((await restoreRecentModelVault('hardware', [])).length, 0);
    assert.equal(await archiveRecentModels('hardware', [{ id: 'physical-1', blocks: [] }]), true);
    await eraseRecentModel('digital', 'project-1');
    const projectsAfterDelete = await restoreRecentModelVault('digital', []);
    assert.equal(projectsAfterDelete.length, 35);
    assert.equal(projectsAfterDelete.some(model => model.id === 'project-1'), false);
    assert.equal((await restoreRecentModelVault('hardware', [])).length, 1);
    await eraseAllRecentModels('hardware');
    assert.equal((await restoreRecentModelVault('hardware', [])).length, 0);
    assert.equal((await restoreRecentModelVault('digital', [])).length, 35);
  } finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
});

test('recent snapshots no longer have an age/count eviction policy, and explicit deletion is confirmed', () => {
  assert.doesNotMatch(engine, /RECENT_MODELS_LIMIT\s*=\s*24|\.slice\(0,\s*RECENT_MODELS_LIMIT\)/);
  assert.match(engine, /recentModelsMemory\s*=\s*\[\.\.\.merged\.values\(\)\]/);
  assert.match(engine, /archiveRecentModels\(BUILDER_MODE, recents\)/);
  assert.doesNotMatch(engine, /window\.confirm\(/);
  assert.match(engine, /requestProjectAction\(\{title:'DELETE THIS PROJECT\?'/);
  assert.match(engine, /requestProjectAction\(\{title:'CLEAR ALL RECENTS\?'/);
  assert.match(dialog, /Projects survive restarts in this browser/);
  assert.match(viteConfig, /port:\s*5173,\s*strictPort:\s*true/);
});
