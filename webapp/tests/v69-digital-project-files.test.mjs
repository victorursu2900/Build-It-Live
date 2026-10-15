import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
const component = file => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
function extractFunction(start, following) {
  const ordinary = source.indexOf(`function ${start}(`);
  const asyncVersion = source.indexOf(`async function ${start}(`);
  const from = asyncVersion >= 0 ? asyncVersion : ordinary;
  const to = source.indexOf(`\nasync function ${following}(`, from) >= 0
    ? source.indexOf(`\nasync function ${following}(`, from)
    : source.indexOf(`\nfunction ${following}(`, from);
  assert.ok(from >= 0 && to > from, `Found ${start} function`);
  return source.slice(from, to);
}

test('file picker is owned by load dialog rather than clipped Workbench input', () => {
  const dialog = component('LoadDialog.tsx');
  assert.match(dialog, /id="loadBuildInput"[^>]*type="file"[^>]*accept="\.bil,\.json,\.stl,\.glb,\.obj"/);
  assert.doesNotMatch(component('BuildKit.tsx'), /id="loadBuildInput"/);
  assert.doesNotMatch(component('HardwareKit.tsx'), /id="loadBuildInput"/);
  assert.match(source, /loadBuildInput\.showPicker\(\)/);
  assert.match(source, /else loadBuildInput\.click\(\)/);
  assert.match(source, /loadBuildInput\.addEventListener\('change'/);
});

test('native BIL loading preserves the saved rectangular grid and project name', async () => {
  const env = {
    PROJECT_FILE_FORMAT: 'build-it-live-project', PROJECT_FILE_VERSION: 1,
    CONFIG: { MAX_HEIGHT: 16 }, THREE: { MathUtils: { clamp: (n, lo, hi) => Math.max(lo, Math.min(hi,n)) } },
    getLegacyGridSize: data => data.workspace.gridSize,
    dedupeImportedBlocks: blocks => blocks,
    extractLegacyBlockArray: data => data.model?.blocks,
    normalizeStandardBlockColor: color => color,
  };
  vm.createContext(env);
  vm.runInContext(extractFunction('loadBilProject', 'loadJsonBlocks'), env);
  const project = { format: 'build-it-live-project', version: 1,
    workspace: { gridSize: 8, gridWidth: 4, gridDepth: 8, selectedBlockColor: '#123456' },
    model: { blocks: [{ x: 3, y: 7, z: 0, type: 'standard', color: '#123456' }] },
    project: { name: 'SAVED RECTANGULAR' }, render: { surfaceMode: 'voxel', smoothingStrength: 3 } };
  const value = await env.loadBilProject({ text: async () => JSON.stringify(project) });
  assert.equal(value.gridWidth, 4);
  assert.equal(value.gridDepth, 8);
  assert.equal(value.projectName, 'SAVED RECTANGULAR');
  assert.equal(value.blocks.length, 1);
  assert.equal(value.exactState, true);
});

test('manual Save Project updates Recent Models when autosave is OFF, without duplicate cards', () => {
  let blocks = [{ x: 0, y: 0, z: 0, type: 'standard' }];
  const db = new Map();
  const env = {
    autosaveEnabled: false, storageEnabled: true, activeRecentModelId: null,
    importedProjectName: 'MY SAVE',
    RECENT_MODELS_LIMIT: 24, RECENT_MODELS_STORAGE_KEY: 'digital.recents', AUTOSAVE_STORAGE_KEY: 'digital.autosave',
    globalThis: { crypto: { randomUUID: () => 'model-1' } },
    setAutosaveUi: () => {}, renderRecentModels: () => {},
    formatAutosaveTime: () => 'Saved',
    makeStoredSnapshot: () => ({ blocks: structuredClone(blocks), savedAt: new Date().toISOString(), gridWidth: 8, gridDepth: 16 }),
    readRecentModels: () => db.get('digital.recents') ?? [],
    setActiveRecentModel: id => { env.activeRecentModelId = id; },
    makeUniqueSmartModelName: () => 'MODEL',
    safeStorageWrite: (key, value) => { db.set(key, structuredClone(value)); return true; },
  };
  vm.createContext(env);
  vm.runInContext(extractFunction('persistCurrentModel', 'scheduleAutosave'), env);
  env.persistCurrentModel({ force: true, addRecent: true, includeEmpty: true });
  assert.equal(db.get('digital.recents').length, 1);
  assert.equal(db.get('digital.recents')[0].name, 'MY SAVE');
  assert.equal(db.get('digital.recents')[0].id, 'model-1');
  blocks = [...blocks, { x: 0, y: 0, z: 1, type: 'standard' }];
  env.persistCurrentModel({ force: true, addRecent: true, includeEmpty: true });
  assert.equal(db.get('digital.recents').length, 1, 'saving same model does not duplicate its history card');
  assert.equal(db.get('digital.recents')[0].blocks.length, 2);
  assert.equal(db.get('digital.autosave').modelId, 'model-1');
});

test('native Save Project registers an explicit Recent Models snapshot and keeps the download', () => {
  let saved = 0; let downloads = 0;
  const env = {
    exactImportedStl: false, autosaveTimer: 10,
    requestDurableBrowserStorage: async () => true,
    window: { clearTimeout: () => {} },
    makeProjectDocument: () => ({ project: { name: 'MY BUILD' } }),
    safeModelFilename: (name, extension) => `${name}.${extension}`,
    downloadBlob: () => { downloads++; },
    persistCurrentModel: options => { saved++; assert.equal(options.force, true); assert.equal(options.includeEmpty, true); },
    Blob,
  };
  vm.createContext(env);
  vm.runInContext(extractFunction('saveNativeProject', 'saveJsonModel'), env);
  assert.equal(env.saveNativeProject(), 'MY BUILD.bil');
  assert.equal(saved, 1);
  assert.equal(downloads, 1);
});

test('successful file import enters Recents immediately and restoring grid precedes block replacement', () => {
  assert.match(source, /setActiveGridSize\(imported\.gridSize[^\n]+\n    restoreRectangularDimensions\(imported\.gridWidth, imported\.gridDepth\);\n    const rejected/);
  assert.match(source, /persistCurrentModel\(\{ force: true, addRecent: true, includeEmpty: true \}\);\n\n    if \(imported\.approximateState\)[\s\S]*?if \(rejected\.length > 0\)/);
  assert.match(component('RecentModelsDialog.tsx'), /Projects survive restarts in this browser/);
});
