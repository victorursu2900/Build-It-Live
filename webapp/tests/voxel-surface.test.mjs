import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoxelSurface } from '../src/domain/voxelSurface.ts';

function meshHealth(blocks) {
  const surface = buildVoxelSurface(blocks, block => block.color);
  const edges = new Map();
  for (const {a,b,c} of surface.triangles) {
    for (const [from,to] of [[a,b],[b,c],[c,a]]) {
      const key = [from,to].sort((u,v) => u-v).join(':');
      const edge = edges.get(key) ?? [];
      edge.push(`${from}:${to}`);
      edges.set(key, edge);
    }
  }
  // Each geometric edge is shared exactly twice, with opposite orientation.
  for (const [key, connections] of edges) {
    assert.equal(connections.length, 2, `non-manifold edge ${key}`);
    assert.equal(connections[0], connections[1].split(':').reverse().join(':'), `flipped edge ${key}`);
  }
  return surface;
}

test('a single block is a closed, consistently oriented 12-triangle solid', () => {
  const surface = meshHealth([{x:0,y:0,z:0,color:'#ff0000'}]);
  assert.equal(surface.vertices.length,8);
  assert.equal(surface.triangles.length,12);
});

test('overhanging six-block arch exports without diagonal repairs or T-junctions', () => {
  const blocks = [
    [0,0,0],[0,0,1],[1,0,1],[2,0,1],[3,0,1],[3,0,0],
  ].map(([x,y,z],i) => ({x,y,z,color: i%2 ? '#e93222' : '#3080ee'}));
  const surface = meshHealth(blocks);
  assert.deepEqual(new Set(surface.triangles.map(t => t.material)),new Set(['#e93222','#3080ee']));
  assert.equal(surface.triangles.length, 52); // 6 cubes: 36 faces - 10 internal = 26 exposed, two tris each
});

test('colored adjacent cubes share exterior only and keep one indexed mesh', () => {
  const blocks=[{x:0,y:0,z:0,color:'#ff0000'},{x:1,y:0,z:0,color:'#0000ff'}];
  const surface=meshHealth(blocks);
  assert.equal(surface.triangles.length,20);
  assert.equal(surface.vertices.length,12);
  assert.equal(surface.triangles.filter(t=>t.material==='#0000ff').length,10);
});
