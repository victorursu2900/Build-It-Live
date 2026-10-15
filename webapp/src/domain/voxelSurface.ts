/**
 * Conforming, exterior-only orthogonal surface for the Builder's printable blocks.
 * All exposed faces use unit-cell quads rather than greedy rectangles: this
 * guarantees that neighboring faces share complete edges (no T-junctions).
 * One mesh is used across all colors; internal color boundaries are not exposed.
 */
export type SurfaceVoxel = { x: number; y: number; z: number; type?: string; color?: string };
export type SurfaceTriangle = { a: number; b: number; c: number; material: string };
export type VoxelSurface = { vertices: [number, number, number][]; triangles: SurfaceTriangle[] };

export function buildVoxelSurface<T extends SurfaceVoxel>(
  blocks: readonly T[], materialFor: (block: T) => string = block => block.color ?? '#e93222',
): VoxelSurface {
  const byCell = new Map<string, T>();
  for (const block of blocks) {
    if (![block.x, block.y, block.z].every(Number.isInteger)) throw new Error('Invalid workspace block coordinate');
    byCell.set(`${block.x},${block.y},${block.z}`, block);
  }
  const vertices: [number, number, number][] = [];
  const indices = new Map<string, number>();
  const triangles: SurfaceTriangle[] = [];
  const vertex = (point: [number, number, number]): number => {
    const key = point.join(',');
    let index = indices.get(key);
    if (index === undefined) {
      index = vertices.length;
      indices.set(key, index);
      vertices.push(point);
    }
    return index;
  };
  const face = (corners: [number, number, number][], material: string) => {
    const [a,b,c,d] = corners.map(vertex);
    triangles.push({a,b,c,material}, {a,b:c,c:d,material});
  };
  for (const block of byCell.values()) {
    const {x,y,z} = block;
    const material = materialFor(block);
    if (!byCell.has(`${x+1},${y},${z}`)) face([[x+1,y,z],[x+1,y+1,z],[x+1,y+1,z+1],[x+1,y,z+1]], material);
    if (!byCell.has(`${x-1},${y},${z}`)) face([[x,y,z],[x,y,z+1],[x,y+1,z+1],[x,y+1,z]], material);
    if (!byCell.has(`${x},${y+1},${z}`)) face([[x,y+1,z],[x,y+1,z+1],[x+1,y+1,z+1],[x+1,y+1,z]], material);
    if (!byCell.has(`${x},${y-1},${z}`)) face([[x,y,z],[x+1,y,z],[x+1,y,z+1],[x,y,z+1]], material);
    if (!byCell.has(`${x},${y},${z+1}`)) face([[x,y,z+1],[x+1,y,z+1],[x+1,y+1,z+1],[x,y+1,z+1]], material);
    if (!byCell.has(`${x},${y},${z-1}`)) face([[x,y,z],[x,y+1,z],[x+1,y+1,z],[x+1,y,z]], material);
  }
  return { vertices, triangles };
}
