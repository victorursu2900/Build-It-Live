import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { approximateStlAsBlocks } from '../src/domain/stlToBlocks.ts';
const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../src/components/BuildControls.tsx', import.meta.url), 'utf8');

function box(x0,y0,z0,x1,y1,z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return faces.flatMap(f=>f.flatMap(i=>v[i]));
}
const bounds = {min:{x:0,y:0,z:0}, max:{x:80,y:40,z:37}};

test('closed STL rectangle approximates two-by-two footprint and two levels', () => {
  const result = approximateStlAsBlocks(box(0,0,0,80,40,37), bounds, { gridWidth:4, gridDepth:8 });
  assert.equal(result.length,8);
  assert.deepEqual(new Set(result.map(b=>b.z)),new Set([0,1]));
  assert.deepEqual(new Set(result.map(b=>b.x)),new Set([1,2]));
  assert.deepEqual(new Set(result.map(b=>b.y)),new Set([3,4]));
});

test('non-rectangular STL approximation preserves spaces rather than filling bounding volume', () => {
  const triangles = [...box(0,0,0,40,20,18.5), ...box(80,0,0,120,20,18.5)];
  const result=approximateStlAsBlocks(triangles,{min:{x:0,y:0,z:0},max:{x:120,y:20,z:18.5}},{gridWidth:5,gridDepth:10});
  assert.equal(result.length,2);
  assert.deepEqual(result.map(b=>b.x),[1,3]);
});

test('too-small grid rejects conversion rather than discarding cells',()=> {
  assert.throws(()=>approximateStlAsBlocks(box(0,0,0,80,40,37), bounds,{gridWidth:1,gridDepth:2}),/INCREASE GRID SIZE/);
});

test('smooth STL keeps exact triangles in either view, with no false cube approximation',()=> {
  assert.doesNotMatch(controls,/convertStlToBlocks|exactStlConvertPanel/);
  assert.doesNotMatch(engine,/function convertImportedStlToEditableBlocks/);
  const loader=engine.slice(engine.indexOf('async function loadStlBlocks('),engine.indexOf('async function decodeModelFile('));
  assert.doesNotMatch(loader,/previewBlocks = approximateStlAsBlocks/);
  assert.match(engine,/exactStlGroup.visible = true/);
  assert.match(loader,/exactStl: \{ buffer, geometry/);
  assert.match(loader,/NO EDITABLE BLOCK TYPES IN FILE/);
});

test('an exact mesh can enlarge its grid, but cannot shrink below its footprint',()=>{
  assert.match(engine,/nextSize < exactImportedStl.minimumColumns/);
  assert.match(engine,/nextSize \* 2 < exactImportedStl.minimumRows/);
  assert.doesNotMatch(engine,/Grid size is locked while an exact STL mesh/);
});

test('future same-browser STL exports are paired with editable state by content, not filename', async () => {
  const vm = await import('node:vm');
  const { webcrypto } = await import('node:crypto');
  const records = new Map();
  const start = engine.indexOf('async function stlContentFingerprint(');
  const end = engine.indexOf('function normalizeExportRegistryName(', start);
  const context = {
    globalThis: { crypto: webcrypto },
    EDITABLE_STL_HASH_REGISTRY_KEY: 'stl-lookup',
    model: { gridSize: 8, gridWidth: 4, gridDepth: 8 },
    exportSurfaceMode: 'soft1', smoothingStrength: 4, selectedBlockColor: '#e93222',
    cloneBlocks: () => [{x:1,y:3,z:0,type:'standard',color:'#e93222'}],
    safeStorageRead: (key, fallback) => records.get(key) ?? fallback,
    safeStorageWrite: (key, value) => { records.set(key, value); return true; },
    Uint8Array,
  };
  vm.createContext(context);
  vm.runInContext(engine.slice(start,end),context);
  const own = new Uint8Array([1,2,3,4]).buffer;
  const altered = new Uint8Array([1,2,3,5]).buffer;
  await context.storeEditableStlExportSnapshot(own);
  const recovered = await context.getEditableStlExportSnapshot(own);
  assert.equal(recovered.blocks.length,1);
  assert.equal(recovered.gridWidth,4);
  assert.equal(recovered.projectState.surfaceMode,'soft1');
  assert.equal(await context.getEditableStlExportSnapshot(altered),null);
  assert.match(engine,/await storeEditableStlExportSnapshot\(exported.buffer\)/);
});

test('loaded STL remains visible and centered when the grid is enlarged', async () => {
  const vm = await import('node:vm');
  const { VoxelModel } = await import('../src/domain/VoxelModel.ts');
  const { centerWorkspaceBlocks } = await import('../src/domain/centerWorkspaceBlocks.ts');
  const model = new VoxelModel({ gridSize: 16, maxHeight: 16 });
  model.setGridDimensions(2, 3);
  const mesh = { minimumColumns: 2, minimumRows: 3, rawGeometry: { name: 'mesh' } };
  const events = [];
  const env = {
    model, exactImportedStl: mesh, IS_HARDWARE_BUILDER: false,
    serialConnected: false, simulationActive: false,
    clampGridSize: n => Math.max(1,Math.min(8,n)),
    CONFIG: { WORKSPACE_COLUMNS:8, MIN_GRID_SIZE:1 },
    updateGridUi: () => events.push('ui'),
    updateGridSceneGeometry: () => events.push('grid'),
    setLayerView: () => {}, syncViewFromModel: () => events.push('render'),
    cloneBlocks: () => [], centerWorkspaceBlocks,
    recolorSelectedKeys: new Set(), updateRecolorTargetUi: () => {},
    modelBlockKey: () => '', ghost:{visible: false}, hoveredCandidate:null,
    resetHistoryToCurrent: () => {}, scheduleAutosave: () => {},
    systemStatus:{textContent:''},setFeedback: (...args) => events.push(args[0]),
  };
  vm.createContext(env);
  const from = engine.indexOf('function setActiveGridSize(');
  const to = engine.indexOf('\nfunction snapshotSignature(', from);
  vm.runInContext(engine.slice(from,to), env);
  assert.equal(env.setActiveGridSize(4),true);
  assert.equal(`${model.gridWidth}×${model.gridDepth}`,'4×8');
  assert.equal(env.exactImportedStl,mesh, 'mesh is not destroyed by resizing');
  assert.ok(events.includes('render'));
  assert.equal(env.setActiveGridSize(1),false,'cannot shrink below mesh footprint');
  assert.equal(`${model.gridWidth}×${model.gridDepth}`,'4×8');
});
