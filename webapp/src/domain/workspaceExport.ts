/** Pure export helpers shared by both Builder modes (NOT Brick Maker). */
export type WorkspaceBlock = { x: number; y: number; z: number; type: string; color?: string };

/** Derive physical export size from the exact cuboids rendered in the editor. */
export function workspaceBlockDimensionsMm(cellWidth: number, cellDepth: number, cellHeight: number, millimetresPerSceneUnit: number) {
  return {
    width: cellWidth * millimetresPerSceneUnit,
    depth: cellDepth * millimetresPerSceneUnit,
    height: cellHeight * millimetresPerSceneUnit,
  };
}

/** Keep distinct colors as separate printable solids; join same-color neighbors. */
export function groupWorkspaceBlocks<T extends WorkspaceBlock>(blocks: readonly T[], normalizeColor: (color: string | undefined) => string) {
  const byAppearance = new Map<string, { type: string; color: string; blocks: T[] }>();
  for (const block of blocks) {
    const type = block.type === 'support' ? 'support' : 'standard';
    const color = type === 'support' ? '#dde1df' : normalizeColor(block.color);
    const key = `${type}|${color}`;
    if (!byAppearance.has(key)) byAppearance.set(key, { type, color, blocks: [] });
    byAppearance.get(key)!.blocks.push(block);
  }
  return [...byAppearance.values()];
}
