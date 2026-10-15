/** Pure placement for arbitrary STL coordinates in a Z-up, millimetre mesh. */
export function getStlPreviewLayout(
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  millimetresPerUnit = 20,
) {
  const { min, max } = bounds;
  if (![min.x, min.y, min.z, max.x, max.y, max.z, millimetresPerUnit].every(Number.isFinite) ||
      millimetresPerUnit <= 0 || max.x < min.x || max.y < min.y || max.z < min.z) {
    throw new Error('INVALID STL BOUNDS');
  }
  const widthMm = max.x - min.x;
  const depthMm = max.y - min.y;
  const heightMm = max.z - min.z;
  const centerX = (min.x + max.x) / 2;
  const centerY = (min.y + max.y) / 2;
  return {
    size: { width: widthMm / millimetresPerUnit, depth: depthMm / millimetresPerUnit, height: heightMm / millimetresPerUnit },
    gridWidth: Math.max(1, Math.min(8, Math.ceil(widthMm / 40))),
    gridDepth: Math.max(1, Math.min(16, Math.ceil(depthMm / 20))),
    maxWorldDimension: Math.max(widthMm, depthMm, heightMm) / millimetresPerUnit,
    toWorld(xMm: number, yMm: number, zMm: number): [number, number, number] {
      return [(xMm - centerX) / millimetresPerUnit, (zMm - min.z) / millimetresPerUnit, (centerY - yMm) / millimetresPerUnit];
    },
  };
}
