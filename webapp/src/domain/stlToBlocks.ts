/**
 * Approximate, automatic fallback conversion of a closed STL triangle surface into the
 * Builder's editable 40 × 20 × 18.5 mm workspace cells. STL stores geometry,
 * not original block identities, support types or individual colors.
 *
 * This samples the inside of the mesh at each possible cell location; it does
 * not claim to recover the original construction. When a solid shape can be sampled, the importer generates editable blocks
 * automatically. Shapes that cannot be sampled remain exact, view-only meshes.
 */
export interface StlBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface EditableStlBlock {
  x: number; y: number; z: number; type: 'standard'; color: string;
}

export function approximateStlAsBlocks(
  positions: ArrayLike<number>,
  bounds: StlBounds,
  options: {
    gridWidth: number; gridDepth: number; maxHeight?: number;
    cellWidthMm?: number; cellDepthMm?: number; cellHeightMm?: number;
    color?: string;
  },
): EditableStlBlock[] {
  const { min, max } = bounds;
  const cellW = options.cellWidthMm ?? 40;
  const cellD = options.cellDepthMm ?? 20;
  const cellH = options.cellHeightMm ?? 18.5;
  const maxHeight = options.maxHeight ?? 16;
  const { gridWidth, gridDepth } = options;
  if (![min.x, min.y, min.z, max.x, max.y, max.z, cellW, cellD, cellH].every(Number.isFinite) ||
    cellW <= 0 || cellD <= 0 || cellH <= 0 || positions.length % 9 !== 0 || positions.length < 36 ||
    max.x <= min.x || max.y <= min.y || max.z <= min.z) {
    throw new Error('INVALID STL SURFACE FOR BLOCK CONVERSION');
  }

  // Allow a small geometric overhang beyond a cell edge without adding an
  // entire fake row; otherwise reject models too large for the editable grid.
  const countX = Math.max(1, Math.ceil((max.x - min.x - 0.2) / cellW));
  const countY = Math.max(1, Math.ceil((max.y - min.y - 0.2) / cellD));
  const countZ = Math.max(1, Math.ceil((max.z - min.z - 0.2) / cellH));
  if (countX > gridWidth || countY > gridDepth) {
    throw new Error(`STL FOOTPRINT NEEDS AT LEAST ${countX}×${countY} CELLS / INCREASE GRID SIZE FIRST`);
  }
  if (countZ > maxHeight) {
    throw new Error(`STL EXCEEDS ${maxHeight} LAYERS / CANNOT CONVERT WITHOUT CROPPING`);
  }

  // Pre-bin triangles by footprint cell to avoid scanning every triangle for
  // each ray. Vertical projections of side walls have zero area and do not
  // affect vertical inside/outside tests.
  const buckets: number[][] = Array.from({ length: countX * countY }, () => []);
  for (let p = 0; p < positions.length; p += 9) {
    const ax = Number(positions[p]), ay = Number(positions[p + 1]);
    const bx = Number(positions[p + 3]), by = Number(positions[p + 4]);
    const cx = Number(positions[p + 6]), cy = Number(positions[p + 7]);
    if (![ax, ay, bx, by, cx, cy].every(Number.isFinite)) continue;
    const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(area) < 1e-9) continue;
    const loX = Math.max(0, Math.floor((Math.min(ax, bx, cx) - min.x) / cellW));
    const hiX = Math.min(countX - 1, Math.floor((Math.max(ax, bx, cx) - min.x) / cellW));
    const loY = Math.max(0, Math.floor((Math.min(ay, by, cy) - min.y) / cellD));
    const hiY = Math.min(countY - 1, Math.floor((Math.max(ay, by, cy) - min.y) / cellD));
    for (let y = loY; y <= hiY; y++) for (let x = loX; x <= hiX; x++) {
      buckets[y * countX + x].push(p);
    }
  }

  // Five off-edge probes per cell make smoothed/thin geometry less sensitive
  // to an individual ray landing on a triangle edge or narrow indentation.
  const probes = [[.5, .5], [.3, .5], [.7, .5], [.5, .3], [.5, .7]];
  const blocks: EditableStlBlock[] = [];
  const offsetX = Math.floor((gridWidth - countX) / 2);
  const offsetY = Math.floor((gridDepth - countY) / 2);
  for (let y = 0; y < countY; y++) for (let x = 0; x < countX; x++) {
    const surfaceTriangles = buckets[y * countX + x];
    if (!surfaceTriangles.length) continue;
    const filled = new Uint8Array(countZ);
    for (const [fx, fy] of probes) {
      const sampleX = Math.min(max.x - 1e-4, min.x + (x + fx) * cellW);
      const sampleY = Math.min(max.y - 1e-4, min.y + (y + fy) * cellD);
      const zs: number[] = [];
      for (const p of surfaceTriangles) {
        const ax = Number(positions[p]), ay = Number(positions[p + 1]);
        const bx = Number(positions[p + 3]), by = Number(positions[p + 4]);
        const cx = Number(positions[p + 6]), cy = Number(positions[p + 7]);
        const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(denom) < 1e-9) continue;
        const u = ((by - cy) * (sampleX - cx) + (cx - bx) * (sampleY - cy)) / denom;
        const v = ((cy - ay) * (sampleX - cx) + (ax - cx) * (sampleY - cy)) / denom;
        if (u < -1e-6 || v < -1e-6 || u + v > 1.000001) continue;
        const z = u * Number(positions[p + 2]) + v * Number(positions[p + 5]) + (1 - u - v) * Number(positions[p + 8]);
        if (Number.isFinite(z)) zs.push(z);
      }
      zs.sort((a, b) => a - b);
      // Joined triangles often intersect a ray at exactly the same boundary.
      const levels: number[] = [];
      for (const z of zs) if (!levels.length || Math.abs(z - levels[levels.length - 1]) > .15) levels.push(z);
      for (let z = 0; z < countZ; z++) {
        const testZ = min.z + (z + .5) * cellH;
        let crossings = 0;
        for (const boundary of levels) if (boundary > testZ) crossings++;
        if (crossings % 2 === 1) filled[z]++;
      }
    }
    for (let z = 0; z < countZ; z++) {
      if (filled[z] >= 2) blocks.push({ x: x + offsetX, y: y + offsetY, z, type: 'standard', color: options.color ?? '#e93222' });
    }
  }
  if (!blocks.length) throw new Error('NO BLOCK CENTERS DETECTED / STL MAY BE TOO THIN OR OPEN FOR CONVERSION');
  return blocks;
}
