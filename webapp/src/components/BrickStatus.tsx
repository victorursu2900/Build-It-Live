import type { JSX } from 'react';

/** Preserved brickmaker layout — React owns this markup. */
export function BrickStatus(): JSX.Element {
  return (
    <p id="brickStatus" className="visually-hidden" aria-live="polite">
      {"Draw at least one base brick to generate a printable layout."}
    </p>
  );
}
