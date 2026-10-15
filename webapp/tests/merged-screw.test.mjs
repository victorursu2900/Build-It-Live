import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mergeScrewSurfaces, countScrewIslands, SCREW_GRID } from '../src/domain/mergedScrewGeometry.ts';
const buffer = fs.readFileSync(fileURLToPath(new URL('../src/assets/blockScrew.stl', import.meta.url)));
const TRIANGLES = buffer.readUInt32LE(80);
const size = { width: 40, depth: 20, height: 18.5 };
const origin = [-5, 10, 0]; // source STL bounds: [-25,0,0] to [15,20,18.5]
const source = new Float32Array(TRIANGLES * 9);
for (let t = 0; t < TRIANGLES; t++) for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
  source[t * 9 + v * 3 + a] = buffer.readFloatLE(84 + t * 50 + 12 + v * 12 + a * 4) - origin[a];
}
function topology(position) {
  const edges = new Map();
  const vertex = i => Array.from(position.slice(i, i + 3), n => Math.round(n * 10000)).join(',');
  for (let t = 0; t < position.length; t += 9) {
    const p = [vertex(t), vertex(t + 3), vertex(t + 6)];
    for (let n = 0; n < 3; n++) {
      const pair = [p[n], p[(n + 1) % 3]].sort().join('->');
      edges.set(pair, (edges.get(pair) ?? 0) + 1);
    }
  }
  return {
    watertight: [...edges.values()].every(count => count === 2),
    triangles: position.length / 9,
  };
}
function assertUnion(cells, expectedTriangles) {
  const merged = mergeScrewSurfaces(source, cells, size);
  const info = topology(merged);
  assert.equal(info.triangles, expectedTriangles);
  assert.equal(info.watertight, true, 'every undirected edge must be used exactly twice');
  return merged;
}
test('8 by 16 drawing area and its physical 320 by 320 mm footprint', () => {
  assert.deepEqual(SCREW_GRID, { columns: 8, rows: 16 });
  assert.equal(SCREW_GRID.columns * size.width, 320);
  assert.equal(SCREW_GRID.rows * size.depth, 320);
});
test('adjacent X blocks form one watertight shell, without internal walls', () => {
  assertUnion([[0,0],[1,0]], 604);
});
test('adjacent Y blocks form one watertight shell', () => {
  assertUnion([[0,0],[0,1]], 604);
});
test('L and solid rectangles preserve all connectors and remove shared interfaces', () => {
  assertUnion([[0,0],[1,0],[1,1]], 896);
  assertUnion([[0,0],[0,1],[1,0],[1,1]], 1168);
  assertUnion([[0,0],[0,1],[1,0],[2,0]], 1180);
});
test('isolated blocks remain independent watertight islands', () => {
  assertUnion([[0,0],[3,3]], 640);
  assert.equal(countScrewIslands([[0,0],[3,3]]), 2);
  assert.equal(countScrewIslands([[0,0],[0,1],[1,1],[1,0]]), 1);
});
test('one block remains exactly the source geometry, translated without deformation', () => {
  const out = assertUnion([[1,2]], 320);
  assert.equal(out[2], source[2]);
  assert.equal(out[0], source[0] + 20);
  assert.equal(out[1], source[1] + 10);
});
test('selected internal top rims are blended, but exposed outer rims remain unchanged', () => {
  const out = assertUnion([[0,0],[1,0]], 604);
  assert.ok(Array.from(out).some((z, i) => i % 3 === 2 && Math.abs(z - 17.5) < 1e-3));
});
test('outer corners keep their source chamfer, but exposed internal side seams are square', () => {
  const merged = assertUnion([[0,0],[1,0],[0,1],[1,1]], 1168);
  const point = (x,y,z) => {
    for (let i=0; i<merged.length; i+=3) {
      if (Math.abs(merged[i]-x)<.0002 && Math.abs(merged[i+1]-y)<.0002 && Math.abs(merged[i+2]-z)<.0002) return true;
    }
    return false;
  };
  assert.ok(point(40,0,0), 'outside straight edge runs through the middle joint');
  assert.ok(point(40,40,0), 'opposite outside edge runs through the middle joint');
  assert.ok(point(40,20,17.5), 'four-way junction closes at the original rim height');
  assert.ok(!point(0,0,0), 'true outside corner retains the source chamfer');
});
test('multiple interior junctions remain watertight in connected larger builds', () => {
  const cells = Array.from({length: 9}, (_, i) => [i%3, Math.floor(i/3)]);
  const result=mergeScrewSurfaces(source, cells, size);
  assert.equal(topology(result).watertight, true);
});
test('entire 8×16 layout remains watertight and bounds stay at 320×320mm', () => {
  const cells=Array.from({length: 128},(_,i)=>[i%8,Math.floor(i/8)]);
  const result=mergeScrewSurfaces(source,cells,size);
  assert.equal(topology(result).watertight,true);
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let i=0;i<result.length;i+=3){minX=Math.min(minX,result[i]);maxX=Math.max(maxX,result[i]);minY=Math.min(minY,result[i+1]);maxY=Math.max(maxY,result[i+1]);}
  assert.equal(minX,0);assert.equal(maxX,320);assert.equal(minY,0);assert.equal(maxY,320);
});
test('two-block seam has a square, uninterrupted external side at both ends', () => {
  for (const [cells, seamPoints] of [
    [[[0,0],[1,0]], [[40,0,0],[40,20,0]]],
    [[[0,0],[0,1]], [[0,20,0],[40,20,0]]],
  ]) {
    const positions = assertUnion(cells, 604);
    for (const [x, y, z] of seamPoints) {
      let found = false;
      for (let i = 0; i < positions.length; i += 3) {
        if (Math.abs(positions[i] - x) < .0002 &&
            Math.abs(positions[i + 1] - y) < .0002 &&
            Math.abs(positions[i + 2] - z) < .0002) { found = true; break; }
      }
      assert.ok(found, `no chamfer notch at exposed seam (${x}, ${y}, ${z})`);
    }
  }
});
