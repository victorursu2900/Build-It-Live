import type { JSX } from 'react';
import type { BuilderMode } from '../domain/builderMode';

/** Preserved index layout — React owns this markup. */
export function LiveFeedback({ mode = 'digital' }: { mode?: BuilderMode }): JSX.Element {
  return (
    <section className="feedback-card" aria-live="polite">
      <span className="feedback-number">
        {mode === 'hardware' ? '03 / LIVE FEEDBACK' : '02 / LIVE FEEDBACK'}
      </span>
      <strong id="feedbackTitle">
        {mode === 'hardware' ? 'AWAITING HARDWARE' : 'PLACE ON BASE'}
      </strong>
      <p id="feedbackText">
        {mode === 'hardware' ? 'Connect ESP32 to mirror the physical build.' : 'Hover a cell or block face to preview a physically valid placement.'}
      </p>
    </section>
  );
}
