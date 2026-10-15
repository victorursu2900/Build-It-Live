/**
 * Reposition an existing digital build in a resized rectangular workspace.
 *
 * Center the OCCUPIED footprint, not the old grid origin: a small sculpture
 * built near the corner of a 4×8 grid should appear near the middle of a
 * larger workspace. Z, block types, colors, and relative positions are intact.
 * An odd amount of unused space gives one extra cell on the far/right side.
 * This is only called for interactive Digital Builder resizes, never for
 * loading a saved project or mapping a physical sensor board.
 */
export function centerWorkspaceBlocks<T extends { x: number; y: number; z: number }>(
  blocks: readonly T[],
  columns: number,
  rows: number,
): { fits: boolean; shifted: boolean; offsetX: number; offsetY: number; blocks: T[] } {
  const unchanged = { fits: true, shifted: false, offsetX: 0, offsetY: 0, blocks: [...blocks] };
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    return { ...unchanged, fits: false };
  }
  if (!blocks.length) return unchanged;

  const minX = Math.min(...blocks.map(block => block.x));
  const maxX = Math.max(...blocks.map(block => block.x));
  const minY = Math.min(...blocks.map(block => block.y));
  const maxY = Math.max(...blocks.map(block => block.y));
  const occupiedColumns = maxX - minX + 1;
  const occupiedRows = maxY - minY + 1;
  if (occupiedColumns > columns || occupiedRows > rows) {
    return { ...unchanged, fits: false };
  }

  const offsetX = Math.floor((columns - occupiedColumns) / 2) - minX;
  const offsetY = Math.floor((rows - occupiedRows) / 2) - minY;
  return {
    fits: true,
    shifted: offsetX !== 0 || offsetY !== 0,
    offsetX,
    offsetY,
    blocks: blocks.map(block => ({ ...block, x: block.x + offsetX, y: block.y + offsetY })),
  };
}
