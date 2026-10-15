import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getStlPreviewLayout } from '../src/domain/stlPreviewLayout.ts';
import { approximateStlAsBlocks } from '../src/domain/stlToBlocks.ts';
import { readEditableStateFromStl } from '../src/domain/stlEditableState.ts';

const source = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
const loadSource = source.slice(source.indexOf('async function loadStlBlocks('), source.indexOf('\nasync function decodeModelFile('));
const STAMP = 'BUILD IT LIVE / STATIC STL EXPORT';

function fakeFile(name, header = STAMP) {
  const bytes = new Uint8Array(84);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80));
  return { name, arrayBuffer: async () => bytes.buffer };
}

function box(x0,y0,z0,x1,y1,z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return faces.flatMap(f=>f.flatMap(i=>v[i]));
}

function harness(bounds, triangleArray = new Array(36).fill(0)) {
  let disposed = 0;
  const geometry = {
    boundingBox: null,
    getAttribute: () => ({ count: triangleArray.length / 3, array: triangleArray }),
    computeBoundingBox() { this.boundingBox = { ...bounds, isEmpty: () => false }; },
    dispose() { disposed++; },
  };
  const env = {
    TextDecoder, Uint8Array, Number, Math,
    CONFIG: { GRID_SIZE: 16, PHYSICAL_BLOCK_MM: 20, MAX_HEIGHT: 16, CELL_WIDTH: 2, CELL_DEPTH: 1, CELL_HEIGHT: .925 },
    approximateStlAsBlocks, IS_HARDWARE_BUILDER: false,
    STLLoader: class { parse() { return geometry; } },
    getStlPreviewLayout,
    getEditableStlExportSnapshot: () => null,
    readEditableStateFromStl,
    extractVoxelStateFromBinaryStl: () => null,
    decodeCompactStlMetadataFromBuffer: () => null,
    extractStlExportId: () => null,
    recoverRegisteredStlState: () => null,
    recoverLegacyStlStateFromRecents: () => null,
    isClearlyLegacyVoxelStl: () => false,
  };
  vm.createContext(env);
  vm.runInContext(loadSource, env);
  return { importFile: env.loadStlBlocks, getDisposed: () => disposed, geometry };
}

const bounds = {min:{x:120,y:-40,z:50},max:{x:200,y:20,z:87}};

test('unrecoverable STL stays as exact geometry without losing its original bytes', async () => {
  const app = harness(bounds);
  const file = fakeFile('my-saved-model.stl');
  const originalBuffer = await file.arrayBuffer();
  const imported = await app.importFile(file);
  assert.equal(imported.exactStl.buffer, originalBuffer);
  assert.equal(imported.exactStl.geometry, app.geometry);
  assert.equal(imported.gridWidth, 2);
  assert.equal(imported.gridDepth, 3);
  assert.equal(app.getDisposed(), 0, 'keep geometry alive for exact preview');
  assert.match(imported.note, /ORIGINAL STL GEOMETRY PRESERVED/);
});

test('open or unrecognizable STL is accepted without inventing blocks', async () => {
  const app = harness(bounds);
  const imported = await app.importFile(fakeFile('object-from-slicer.stl', 'solid model'));
  assert.equal(imported.exactStl.geometry, app.geometry);
  assert.equal(imported.blocks, undefined);
  assert.match(imported.note, /ORIGINAL STL GEOMETRY PRESERVED/);
});

test('smooth solid without embedded blocks remains visually exact, not guessed', async () => {
  const shape = box(0,0,0,80,40,37);
  const app = harness({min:{x:0,y:0,z:0},max:{x:80,y:40,z:37}}, shape);
  const file = fakeFile('old-smooth-export.stl', 'solid exported');
  const original = await file.arrayBuffer();
  const imported = await app.importFile(file);
  assert.equal(imported.exactStl.buffer, original);
  assert.equal(imported.exactStl.geometry, app.geometry);
  assert.equal(imported.blocks, undefined);
  assert.equal(app.getDisposed(), 0);
  assert.equal(imported.gridWidth, 2);
  assert.equal(imported.gridDepth, 2);
  assert.match(imported.note, /ORIGINAL STL GEOMETRY PRESERVED/);
});

test('coordinate placement centers arbitrary and negative STL XY bounds, sets lowest Z on base', () => {
  const layout = getStlPreviewLayout(bounds, 20);
  assert.deepEqual(layout.toWorld(160, -10, 50), [0, 0, 0]);
  assert.deepEqual(layout.toWorld(120, -40, 87), [-2, 1.85, 1.5]);
  assert.equal(layout.maxWorldDimension, 4);
});

test('malformed non-finite STL bounds fail instead of silently clearing existing project', async () => {
  const app = harness({ min: {x:0,y:0,z:0}, max:{x:NaN,y:20,z:10} });
  await assert.rejects(app.importFile(fakeFile('corrupt.stl')), /NO VALID TRIANGLE GEOMETRY/);
  assert.equal(app.getDisposed(), 1);
  assert.match(source, /const imported = await decodeModelFile\(file\);[\s\S]*?setActiveRecentModel\(null\);/, 'decoder runs before replacing project');
});

test('STL dialog distinguishes exact mesh, estimated blocks and native BIL editing', () => {
  const dialog = readFileSync(new URL('../src/components/LoadDialog.tsx', import.meta.url), 'utf8');
  assert.match(dialog, /OPEN 3D MESH/);
  assert.match(dialog, /cubes restored only if saved/);
  assert.match(dialog, /guaranteed, portable editing/);
});
