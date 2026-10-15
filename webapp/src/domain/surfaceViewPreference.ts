/**
 * A view choice is specific to an editable model, not a global default.
 * Keep this separate from the debounced geometry autosave: changing a view
 * immediately before navigating away must not restore an older Smooth state.
 */
export type SurfaceViewMode = 'voxel' | 'soft1';

export type SurfaceViewPreference = {
  modelId: string | null;
  surfaceMode: SurfaceViewMode;
};

function normalizeModelId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function makeSurfaceViewPreference(modelId: unknown, mode: unknown): SurfaceViewPreference {
  return {
    modelId: normalizeModelId(modelId),
    surfaceMode: mode === 'soft1' ? 'soft1' : 'voxel',
  };
}

export function restoreModelSurfaceView(
  snapshot: { modelId?: unknown; surfaceMode?: unknown },
  candidate: unknown,
): SurfaceViewMode {
  const savedMode: SurfaceViewMode = snapshot.surfaceMode === 'soft1' ? 'soft1' : 'voxel';
  if (!candidate || typeof candidate !== 'object') return savedMode;
  const preference = candidate as Partial<SurfaceViewPreference>;
  if (preference.surfaceMode !== 'soft1' && preference.surfaceMode !== 'voxel') return savedMode;
  // Do not apply the view of a previously opened model to a different model.
  const savedId = normalizeModelId(snapshot.modelId);
  if (!savedId || normalizeModelId(preference.modelId) !== savedId) return savedMode;
  return preference.surfaceMode;
}
