import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREW_BLOCK, getScrewBlockLayoutSize } from '../src/domain/screwBlock.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const stl = fs.readFileSync(path.resolve(root, '../src/assets/blockScrew.stl'));
function stlBounds(buffer) {
  const tris = buffer.readUInt32LE(80);
  assert.equal(buffer.byteLength, 84 + tris * 50, 'Expected a complete binary STL');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < tris; t++) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
    const coord = buffer.readFloatLE(84 + t * 50 + 12 + v * 12 + a * 4);
    min[a] = Math.min(min[a], coord); max[a] = Math.max(max[a], coord);
  }
  return { extents: min.map((x, i) => max[i] - x), triangles: tris };
}

test('bundled screw block matches the source 40×20×18.5 geometry', () => {
  const { extents, triangles } = stlBounds(stl);
  assert.deepEqual(extents.map(v => Math.round(v * 1000) / 1000), [40, 20, 18.5]);
  assert.equal(triangles, 320);
  assert.equal(SCREW_BLOCK.sourceFilename, 'blockScrew(1).stl');
  assert.equal(SCREW_BLOCK.footprintAspectRatio, 2);
});
test('one grid cell means one complete source block', () => {
  assert.deepEqual(getScrewBlockLayoutSize(1, 1), {width: 40, depth: 20, height: 18.5});
  assert.deepEqual(getScrewBlockLayoutSize(2, 3), {width: 80, depth: 60, height: 18.5});
  assert.deepEqual(getScrewBlockLayoutSize(0, 0), {width: 0, depth: 0, height: 0});
  assert.throws(() => getScrewBlockLayoutSize(-1, 1), RangeError);
});
