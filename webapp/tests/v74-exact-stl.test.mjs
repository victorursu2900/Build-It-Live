import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { embedEditableStateInStl, readEditableStateFromStl } from '../src/domain/stlEditableState.ts';

function stl(tris) {
  const bytes = new Uint8Array(84 + 50 * tris);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, tris, true);
  // Valid, non-zero normals + unique vertex coordinates to catch accidental
  // geometry alterations from the exact-project metadata writer.
  for (let t = 0; t < tris; t++) {
    for (let v = 0; v < 12; v++) view.setFloat32(84 + 50 * t + v * 4, v % 3 === 2 ? 1 : t + v / 32, true);
  }
  return bytes.buffer;
}
function trianglesSame(source, exported) {
  const original = new Uint8Array(source), result = new Uint8Array(exported);
  assert.equal(result.length, original.length);
  assert.deepEqual(result.slice(80, 84), original.slice(80, 84));
  for (let offset = 84; offset < original.length; offset += 50) {
    assert.deepEqual(result.slice(offset + 12, offset + 50), original.slice(offset + 12, offset + 50), `vertices changed at ${offset}`);
    for (let c = 0; c < 3; c++) {
      const x = new DataView(source).getFloat32(offset + 4*c, true);
      const y = new DataView(exported).getFloat32(offset + 4*c, true);
      assert.ok(Math.abs(x - y) < 0.001, 'only insignificant normal bits may change');
    }
  }
}

const project = {
  gridWidth: 4, gridDepth: 8, surfaceMode: 'soft1', smoothingStrength: 4,
  blocks: [
    { x: 0, y: 0, z: 0, type: 'support' },
    { x: 0, y: 0, z: 1, type: 'standard', color: '#e93222' },
    { x: 1, y: 6, z: 0, type: 'standard', color: '#1263a7' },
  ],
};

test('exact STL round-trip keeps Standard/Support types, positions, colors, view, and rectangular grid', () => {
  const source = stl(40);
  const output = embedEditableStateInStl(source, project);
  assert.ok(output);
  assert.equal(output.colorsExact, true);
  trianglesSame(source, output.buffer);
  const restored = readEditableStateFromStl(output.buffer);
  assert.ok(restored);
  assert.equal(restored.gridWidth, 4);
  assert.equal(restored.gridDepth, 8);
  assert.equal(restored.surfaceMode, 'soft1');
  assert.equal(restored.smoothingStrength, 4);
  assert.deepEqual(restored.blocks, project.blocks);
});

test('Rounded profile survives the portable STL metadata round trip without changing geometry', () => {
  const source = stl(40);
  const output = embedEditableStateInStl(source, {...project, smoothEdgeProfile: 'rounded'});
  assert.ok(output);
  trianglesSame(source, output.buffer);
  const reopened = readEditableStateFromStl(output.buffer);
  assert.equal(reopened.smoothEdgeProfile, 'rounded');
  const original = embedEditableStateInStl(stl(40), project);
  assert.equal(readEditableStateFromStl(original.buffer).smoothEdgeProfile, 'classic');
});

test('works for a one-cube printable STL with only 12 triangles', () => {
  const one = { gridWidth: 1, gridDepth: 1, surfaceMode: 'voxel', smoothingStrength: 1,
    blocks: [{ x:0,y:0,z:0,type:'standard',color:'#e93222' }] };
  const output = embedEditableStateInStl(stl(12), one);
  assert.ok(output);
  assert.deepEqual(readEditableStateFromStl(output.buffer).blocks,one.blocks);
});

test('supports remain exact when there is not enough space for custom colors', () => {
  const source = stl(12);
  const compressed = embedEditableStateInStl(source, project);
  assert.ok(compressed);
  assert.equal(compressed.colorsExact, false);
  const result = readEditableStateFromStl(compressed.buffer);
  assert.equal(result.colorsExact, false);
  assert.deepEqual(result.blocks.map(({x,y,z,type}) => ({x,y,z,type})), project.blocks.map(({x,y,z,type})=>({x,y,z,type})));
});

test('too-small STL fails safely instead of claiming exact import', () => {
  const impossible = { ...project, blocks: Array.from({length:15}, (_,i) => ({x:i%4,y:Math.floor(i/4),z:0,type:'support'})) };
  assert.equal(embedEditableStateInStl(stl(12), impossible), null);
});

test('corrupt metadata never recovers inaccurate block data', () => {
  const exported = embedEditableStateInStl(stl(40), project);
  const damaged = exported.buffer.slice(0);
  const view = new DataView(damaged);
  view.setUint32(84, view.getUint32(84, true) ^ 1, true);
  assert.equal(readEditableStateFromStl(damaged), null);
  assert.equal(readEditableStateFromStl(stl(40)), null);
});

test('engine prioritizes exact embedded state before lossless mesh fallback', () => {
  const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
  assert.ok(engine.indexOf('readEditableStateFromStl(buffer)') < engine.indexOf('exactStl: { buffer, geometry'));
  assert.match(engine, /embedEditableStateInStl\(binaryStl/);
  assert.match(engine, /restoreRectangularDimensions\(imported.gridWidth, imported.gridDepth\)/);
});

test('actual STL loader returns the source Standard/Support types before touching mesh geometry', async () => {
  const { default: vm } = await import('node:vm');
  const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
  const source = engine.slice(engine.indexOf('async function loadStlBlocks('), engine.indexOf('\nasync function decodeModelFile('));
  const embedded = embedEditableStateInStl(stl(40), project);
  assert.ok(embedded);
  const env = {
    TextDecoder, Uint8Array, Math,
    getEditableStlExportSnapshot: () => null,
    readEditableStateFromStl,
    dedupeImportedBlocks: blocks => blocks,
    CONFIG: { PHYSICAL_BLOCK_MM: 20 },
    STLLoader: class { parse() { throw new Error('Should never parse an exact model as an approximate mesh'); } },
  };
  vm.createContext(env);
  vm.runInContext(source, env);
  const imported = await env.loadStlBlocks({ name: 'reopened.stl', arrayBuffer: async () => embedded.buffer });
  assert.equal(imported.exactState, true);
  assert.equal(imported.gridWidth, 4);
  assert.equal(imported.gridDepth, 8);
  assert.equal(imported.blocks.length, 3);
  assert.equal(imported.blocks[0].type, 'support');
  assert.equal(imported.blocks[2].color, '#1263a7');
  assert.equal(imported.projectState.surfaceMode, 'soft1');
});
