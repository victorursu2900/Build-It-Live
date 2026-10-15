/** Physical-sensor rules used by ESP32 events and the shared model engine. */
export interface SensorProfile { resistance: number; type: 'standard' | 'support'; color?: string; }

export function validateGridMapping(physical: number, width: number, depth: number, maxSize = 16, physicalDepth = physical): void {
  if (![physical, physicalDepth, width, depth].every((n) => Number.isInteger(n) && n >= 1 && n <= maxSize)) {
    throw new Error(`Grid dimensions must be whole numbers from 1 to ${maxSize}.`);
  }
  if (width < physical || depth < physicalDepth) {
    throw new Error('The digital grid must be at least as large as the physical plate in both dimensions.');
  }
}

export function resistanceFromConductance(measuredUs: number): number | null {
  return Number.isFinite(measuredUs) && measuredUs > 0 ? 1000 / measuredUs : null;
}

export function matchSensorResistance(measuredUs: number, profiles: SensorProfile[], tolerance = 0.25): SensorProfile | null {
  const kOhms = resistanceFromConductance(measuredUs);
  if (kOhms === null) return null;
  let best: SensorProfile | null = null;
  let nearest = Infinity;
  for (const profile of profiles) {
    if (!(Number.isFinite(profile.resistance) && profile.resistance > 0)) continue;
    const error = Math.abs(kOhms - profile.resistance) / profile.resistance;
    if (error <= tolerance && error < nearest) {
      best = profile;
      nearest = error;
    }
  }
  return best;
}

/** Translate a row-major ESP32 channel into a digital cell. One-to-one
 * mapping when the physical and digital dimensions match.
 * The fifth argument preserves compatibility with earlier square boards.
 */
export function sensorChannelToCell(channel: number, physical: number, width: number, depth: number, physicalDepth = physical): { x: number; y: number } {
  validateGridMapping(physical, width, depth, 16, physicalDepth);
  if (!Number.isInteger(channel) || channel < 0 || channel >= physical * physicalDepth) {
    throw new Error('Sensor channel is outside the physical board.');
  }
  return {
    x: Math.floor((width - physical) / 2) + channel % physical,
    y: Math.floor((depth - physicalDepth) / 2) + Math.floor(channel / physical),
  };
}

/** A physical sensor cell maps directly to one digital grid cell.
 * The optional depth keeps the previous square-grid API working. */
export function hardwareDigitalDimensions(boardWidth: number, boardDepth = boardWidth): { width: number; depth: number } {
  if (![boardWidth, boardDepth].every(n => Number.isInteger(n) && n >= 1 && n <= 8)) {
    throw new Error('Physical sensor grid dimensions must be whole numbers from 1 to 8.');
  }
  return { width: boardWidth, depth: boardDepth };
}
