import type { JSX } from 'react';

/** Preserved index layout — React owns this markup. */
export function BuildViewport(): JSX.Element {
  return (
    <main id="viewport" aria-label="Interactive 3D voxel building area"></main>
  );
}
