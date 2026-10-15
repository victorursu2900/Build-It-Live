/** Physical units are millimeters as supplied by the source STL. */
export const SCREW_BLOCK = Object.freeze({
  sourceFilename: 'blockScrew(1).stl',
  dimensions: Object.freeze({ width: 40, depth: 20, height: 18.5 }),
  footprintAspectRatio: 2,
  units: 'mm',
  shape: 'full screw-channel block',
});

/** Grid cells represent complete physical blocks, never half-blocks. */
export function getScrewBlockLayoutSize(columns: number, rows: number) {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 0 || rows < 0) {
    throw new RangeError('Footprint dimensions must be nonnegative integers.');
  }
  return {
    width: columns * SCREW_BLOCK.dimensions.width,
    depth: rows * SCREW_BLOCK.dimensions.depth,
    height: columns && rows ? SCREW_BLOCK.dimensions.height : 0,
  };
}
