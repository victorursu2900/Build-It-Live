/**
 * Shape-aware union of the user's 40 × 20 × 18.5 mm screw block.
 *
 * A single block is copied exactly from the source STL. For connected groups,
 * adjoining faces are removed and the chamfered source corners are squared
 * ONLY at occupied joins. This leaves the genuine outer perimeter corners
 * chamfered but gives every exposed run a continuous, straight side wall.
 * The screw recesses, underside details and original top surface are retained.
 * All triangles are generated at runtime for both preview and exported STL.
 */
export type ScrewCell = readonly [column: number, row: number];
export type ScrewDimensions = Readonly<{ width: number; depth: number; height: number }>;

export const SCREW_GRID = Object.freeze({ columns: 8, rows: 16 });
const EPS = 0.0003;
const SOURCE_CORNER_REACH_MM = 1.25;
const close = (a: number, b: number) => Math.abs(a - b) <= EPS;

export function mergeScrewSurfaces(
  sourcePositions: ArrayLike<number>,
  selection: Iterable<ScrewCell>,
  size: ScrewDimensions,
  _legacyCapInteriorCorners = true,
): Float32Array {
  if (!sourcePositions.length || sourcePositions.length % 9 !== 0) {
    throw new Error('Source positions must contain complete triangles.');
  }
  if (size.width <= 0 || size.depth <= 0 || size.height <= 0) {
    throw new Error('Screw-block dimensions must be positive.');
  }
  const unique = new Map<string, ScrewCell>();
  for (const [x, y] of selection) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Invalid grid coordinates.');
    unique.set(`${x},${y}`, [x, y]);
  }
  const entries = [...unique.values()];
  if (!entries.length) return new Float32Array();
  const occupied = new Set(unique.keys());
  const minX = Math.min(...entries.map(([x]) => x));
  const minY = Math.min(...entries.map(([, y]) => y));
  const halfX = size.width / 2;
  const halfY = size.depth / 2;
  const wallTop = size.height - 1.3;
  const rimTop = size.height - 1.0;
  const positions: number[] = [];

  for (const [x, y] of entries) {
    const left = occupied.has(`${x - 1},${y}`);
    const right = occupied.has(`${x + 1},${y}`);
    const front = occupied.has(`${x},${y - 1}`);
    const back = occupied.has(`${x},${y + 1}`);
    const offsetX = (x - minX + 0.5) * size.width;
    const offsetY = (y - minY + 0.5) * size.depth;

    for (let t = 0; t < sourcePositions.length; t += 9) {
      const xs = [sourcePositions[t], sourcePositions[t + 3], sourcePositions[t + 6]];
      const ys = [sourcePositions[t + 1], sourcePositions[t + 4], sourcePositions[t + 7]];
      const zs = [sourcePositions[t + 2], sourcePositions[t + 5], sourcePositions[t + 8]];

      // Straighten the original 1 mm source chamfer at joining corners.
      // A corner remains chamfered ONLY when both neighboring cells in the
      // corner's directions are absent: true outer perimeter corners.
      for (let v = 0; v < 3; v++) {
        const sx = xs[v] < 0 ? -1 : 1;
        const sy = ys[v] < 0 ? -1 : 1;
        const cornerX = halfX - Math.abs(xs[v]) < SOURCE_CORNER_REACH_MM;
        const cornerY = halfY - Math.abs(ys[v]) < SOURCE_CORNER_REACH_MM;
        if (cornerX && cornerY && ((sx < 0 ? left : right) || (sy < 0 ? front : back))) {
          xs[v] = sx * halfX;
          ys[v] = sy * halfY;
        }
      }
      const onPlane = (values: number[], plane: number) => values.every((value) => close(value, plane));
      // Remove shared side faces, after miter vertices are squared.
      if ((left && onPlane(xs, -halfX)) || (right && onPlane(xs, halfX)) ||
          (front && onPlane(ys, -halfY)) || (back && onPlane(ys, halfY))) continue;

      // Continue the planar top rim across internal joins. Outside chamfers
      // and screw/underside details are left unchanged.
      for (let v = 0; v < 3; v++) {
        const joined = (left && close(xs[v], -halfX)) || (right && close(xs[v], halfX)) ||
          (front && close(ys[v], -halfY)) || (back && close(ys[v], halfY));
        if (joined && close(zs[v], wallTop)) zs[v] = rimTop;
      }

      // Flattened miter faces can have zero area. Omitting those triangles
      // prevents duplicate edges/nonmanifold seams in the STL export.
      const ax = xs[1] - xs[0], ay = ys[1] - ys[0], az = zs[1] - zs[0];
      const bx = xs[2] - xs[0], by = ys[2] - ys[0], bz = zs[2] - zs[0];
      const cx = ay * bz - az * by;
      const cy = az * bx - ax * bz;
      const cz = ax * by - ay * bx;
      if (cx * cx + cy * cy + cz * cz < 1e-10) continue;

      for (let v = 0; v < 3; v++) {
        positions.push(xs[v] + offsetX, ys[v] + offsetY, zs[v]);
      }
    }
  }
  return new Float32Array(positions);
}

/** One watertight merged component per edge-connected group of cells. */
export function countScrewIslands(selection: Iterable<ScrewCell>): number {
  const pending = new Set([...selection].map(([x, y]) => `${x},${y}`));
  let islands = 0;
  while (pending.size) {
    islands++;
    const first = pending.values().next().value as string;
    pending.delete(first);
    const queue = [first];
    for (let q = 0; q < queue.length; q++) {
      const [x, y] = queue[q].split(',').map(Number);
      for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
        if (!pending.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
  }
  return islands;
}
