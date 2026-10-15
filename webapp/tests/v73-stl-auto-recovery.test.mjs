import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../src/components/BuildControls.tsx', import.meta.url), 'utf8');
const loadDialog = readFileSync(new URL('../src/components/LoadDialog.tsx', import.meta.url), 'utf8');
const loader = engine.slice(engine.indexOf('async function loadStlBlocks('), engine.indexOf('async function decodeModelFile('));

test('STL checks exact recoverable blocks before lossless surface fallback', () => {
  assert.ok(loader.indexOf('await getEditableStlExportSnapshot(buffer)') < loader.indexOf('exactStl: { buffer, geometry'));
  assert.ok(loader.indexOf('readEditableStateFromStl(buffer)') < loader.indexOf('exactStl: { buffer, geometry'));
  assert.ok(loader.indexOf('extractVoxelStateFromBinaryStl(buffer)') < loader.indexOf('exactStl: { buffer, geometry'));
});

test('no extra conversion button exists in either Builder', () => {
  assert.doesNotMatch(controls, /Convert to Blocks|convertStlToBlocks|exactStlConvertPanel/i);
  assert.doesNotMatch(engine, /convertImportedStlToEditableBlocks|convertStlToBlocksButton|exactStlConvertPanel/);
});

test('unknown STL preserves its original mesh without inventing cube cells', () => {
  assert.doesNotMatch(loader, /previewBlocks = approximateStlAsBlocks/);
  assert.match(engine, /if \(exactImportedStl && !isApproximateBlockPreview\(\) && normalizedFormat === 'stl'\)/);
  assert.match(loader, /exactStl: \{ buffer, geometry/);
  assert.match(engine, /originalBuffer: buffer.slice\(0\)/);
  assert.match(engine, /exactImportedStl.originalBuffer.slice\(0\)/);
});

test('loading copy explains how exact editable block types can be recovered', () => {
  assert.match(loadDialog, /Original mesh; cubes restored only if saved./);
  assert.match(loadDialog, /guaranteed, portable editing/);
  assert.match(engine, /ORIGINAL MESH PRESERVED/);
});
