import { SCREW_BLOCK } from './screwBlock.ts';
/** Physical dimensions for the 8-column × 16-row Digital Twin workspace. */
export const BUILDER_SCREW_GRID = Object.freeze({ columns: 8, rows: 16 });
export const BUILDER_SCREW_MODULE = SCREW_BLOCK.dimensions;
export function screwWorkspaceSize(columns = 8, rows = 16) {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || columns > 8 || rows < 1 || rows > 16) {
    throw new RangeError('Builder screw grid must be within 8 columns and 16 rows.');
  }
  return { widthMm: columns * BUILDER_SCREW_MODULE.width, depthMm: rows * BUILDER_SCREW_MODULE.depth };
}
export function screwModelCenter(column: number, row: number, layer: number, columns = 8, rows = 16) {
  if (![column,row,layer].every(Number.isInteger) || column < 0 || column >= columns || row < 0 || row >= rows || layer < 0) {
    throw new RangeError('Block coordinates are outside the active grid.');
  }
  return {
    x: (column + .5) * BUILDER_SCREW_MODULE.width - columns * BUILDER_SCREW_MODULE.width / 2,
    y: (row + .5) * BUILDER_SCREW_MODULE.depth - rows * BUILDER_SCREW_MODULE.depth / 2,
    z: (layer + .5) * BUILDER_SCREW_MODULE.height,
  };
}
