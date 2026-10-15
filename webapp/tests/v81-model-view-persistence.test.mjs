import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeSurfaceViewPreference, restoreModelSurfaceView } from '../src/domain/surfaceViewPreference.ts';

const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');

test('returning to the same model restores the last Blocks selection, not its older Smooth autosave', () => {
  const snapshot = { modelId: 'church-42', surfaceMode: 'soft1' };
  const latest = makeSurfaceViewPreference('church-42', 'voxel');
  assert.equal(restoreModelSurfaceView(snapshot, latest), 'voxel');
});

test('returning to Smooth restores Smooth even if the previously saved mode was Blocks', () => {
  assert.equal(restoreModelSurfaceView({ modelId: 'model-a', surfaceMode: 'voxel' },
    makeSurfaceViewPreference('model-a', 'soft1')), 'soft1');
});

test('different models cannot inherit each others view selections', () => {
  assert.equal(restoreModelSurfaceView({ modelId: 'model-b', surfaceMode: 'soft1' },
    makeSurfaceViewPreference('model-a', 'voxel')), 'soft1');
  assert.equal(restoreModelSurfaceView({ modelId: 'model-b', surfaceMode: 'voxel' },
    makeSurfaceViewPreference('model-a', 'soft1')), 'voxel');
});

test('blank-model preferences cannot override an unrelated saved project', () => {
  assert.equal(restoreModelSurfaceView({ modelId: null, surfaceMode: 'soft1' },
    makeSurfaceViewPreference(null, 'voxel')), 'soft1');
});

test('corrupt and missing view preferences safely use the model saved mode', () => {
  const snapshot = { modelId: 'm1', surfaceMode: 'soft1' };
  assert.equal(restoreModelSurfaceView(snapshot, null), 'soft1');
  assert.equal(restoreModelSurfaceView(snapshot, { modelId: 'm1', surfaceMode: 'invalid' }), 'soft1');
});

test('view selection is saved immediately and restoration never writes the old view back', () => {
  assert.match(engine, /if \(remember && previous !== next\) rememberSurfaceView\(\)/);
  assert.match(engine, /surfaceMode: exportSurfaceMode/);
  assert.match(engine, /restoreModelSurfaceView\(snapshot, safeStorageRead\(SURFACE_VIEW_STORAGE_KEY, null\)\)/);
  assert.match(engine, /setExportSurfaceMode\(exportSurfaceMode, \{ rebuild: false, remember: false \}\)/);
  assert.match(engine, /window\.addEventListener\('pagehide'/);
});

test('view choices are stored separately in Digital and Hardware Builder', () => {
  assert.match(engine, /SURFACE_VIEW_STORAGE_KEY = `digital-twin\.\$\{BUILDER_MODE\}\.active-surface-view\.v1`/);
});

test('STL page-return path restores the original triangle buffer and chosen reference view', () => {
  assert.match(engine, /await saveImportedMeshSession\(\{[\s\S]*?buffer: exactImportedStl\.originalBuffer/);
  assert.match(engine, /const session = await loadImportedMeshSession\(\)/);
  assert.match(engine, /new STLLoader\(\)\.parse\(session\.buffer\)/);
  assert.match(engine, /exactImportedStl\.sessionId = session\.id/);
  assert.match(engine, /const surfaceMode = restoreModelSurfaceView\(/);
  assert.match(engine, /setExportSurfaceMode\(surfaceMode, \{ rebuild: false, remember: false \}\)/);
  assert.match(engine, /ACTIVE_WORKSPACE_KIND_KEY, 'blocks'\) === 'mesh'/);
});

test('mesh-only STL cache stores, reads, and clears a binary buffer', async () => {
  const { saveImportedMeshSession, loadImportedMeshSession, clearImportedMeshSession } =
    await import('../src/domain/importedMeshSession.ts');
  const original = globalThis.indexedDB;
  const values = new Map();
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    close() {},
    transaction() {
      const transaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => ({
          put(value, key) {
            values.set(key, value);
            queueMicrotask(() => transaction.oncomplete?.());
          },
          get(key) {
            const request = { result: null, onsuccess: null, onerror: null };
            queueMicrotask(() => {
              request.result = values.get(key);
              request.onsuccess?.();
            });
            return request;
          },
          delete(key) {
            values.delete(key);
            queueMicrotask(() => transaction.oncomplete?.());
          },
        }),
      };
      return transaction;
    },
  };
  globalThis.indexedDB = {
    open() {
      const request = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  try {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const originalMesh = { id: 'church', buffer, gridSize: 4, gridWidth: 4, gridDepth: 8 };
    assert.equal(await saveImportedMeshSession(originalMesh), true);
    const result = await loadImportedMeshSession();
    assert.deepEqual(Array.from(new Uint8Array(result.buffer)), [1, 2, 3, 4]);
    assert.equal(result.id, 'church');
    assert.equal(result.gridDepth, 8);
    await clearImportedMeshSession();
    assert.equal(await loadImportedMeshSession(), null);
  } finally {
    if (original === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = original;
  }
});
