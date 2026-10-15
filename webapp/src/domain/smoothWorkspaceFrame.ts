/** Map the SDF's X/row/height (Z-up) coordinates into the Y-up Builder. */
export function smoothWorkspaceOrigin(
  gridWidth: number, gridDepth: number,
  pitchWidth: number, pitchDepth: number,
  exportScale = 1,
) {
  return {
    x: -gridWidth * pitchWidth * exportScale / 2,
    y: 0,
    z: gridDepth * pitchDepth * exportScale / 2,
  };
}

/** A center point in the smooth field must coincide with the block mesh center. */
export function smoothCellToWorld(
  col: number, row: number, layer: number,
  gridWidth: number, gridDepth: number,
  pitchWidth: number, pitchDepth: number, pitchHeight: number,
) {
  const origin = smoothWorkspaceOrigin(gridWidth, gridDepth, pitchWidth, pitchDepth);
  return {
    x: origin.x + (col + 0.5) * pitchWidth,
    y: (layer + 0.5) * pitchHeight,
    z: origin.z - (row + 0.5) * pitchDepth,
  };
}
