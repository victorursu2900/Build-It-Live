import type { JSX } from 'react';

/** Preserved index layout — React owns this markup. */
export function HelpBar(): JSX.Element {
  return (
    <footer className="helpbar">
      <span>
        <b>
          {"DRAG"}
        </b>
        {" orbit"}
      </span>
      <span>
        <b>
          {"RIGHT DRAG"}
        </b>
        {" pan"}
      </span>
      <span>
        <b>
          {"SCROLL"}
        </b>
        {" zoom"}
      </span>
      <span>
        <b>
          {"CLICK"}
        </b>
        {" place / erase"}
      </span>
    </footer>
  );
}
