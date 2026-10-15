import type { JSX } from 'react';

/** Preserved tutorial layout — React owns this markup. */
export function TutorialFooter(): JSX.Element {
  return (
    <footer className="tutorial-footer">
      <span>
        {"BUILD IT LIVE / DIGITAL MAKING"}
      </span>
      <p>
        {"INTRO → HARDWARE → BRICK MAKER → DIGITAL"}
      </p>
      <a href="#top">
        {"BACK TO TOP ↑"}
      </a>
    </footer>
  );
}
