import type { JSX } from 'react';
import type { BuilderMode } from '../domain/builderMode';

/** Preserved index layout — React owns this markup. */
export function LiveStats({ mode = 'digital' }: { mode?: BuilderMode }): JSX.Element {
  return (
    <aside className="stats-panel" aria-label="Live build statistics">
      <div className="stats-panel__head">
        <div className="panel-label">
          {'01 / LIVE DATA'}
        </div>
        {mode !== 'hardware' && <button id="openGridSettings" className="settings-icon-button" type="button" aria-label="Open grid settings" aria-expanded="false" aria-controls="gridSettingsPopover" title="Grid settings">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z"></path>
            <path d="M19.15 13.48a7.8 7.8 0 0 0 .05-2.96l2.02-1.56-2-3.46-2.5 1a8.5 8.5 0 0 0-2.56-1.48L13.8 2.35H9.8l-.37 2.67A8.5 8.5 0 0 0 6.88 6.5l-2.5-1-2 3.46 2.02 1.56a7.8 7.8 0 0 0 .05 2.96l-2.07 1.6 2 3.46 2.56-1.03a8.4 8.4 0 0 0 2.49 1.43l.37 2.71h4l.37-2.71a8.4 8.4 0 0 0 2.49-1.43l2.56 1.03 2-3.46-2.07-1.6Z"></path>
          </svg>
        </button>}
      </div>
      {mode === 'hardware' ? <>
        {/* The geometry engine still updates its own grid metric; don't confuse loaded
            project dimensions with the configured physical sensor board. */}
        <span id="gridMetric" hidden aria-hidden="true">2×4</span>
        <div className="stats-grid hardware-metrics" aria-label="Live model and board metrics">
          <div className="stat-card stat-card--light"><span>GRID</span><strong id="physicalGridMetric">2×4</strong></div>
          <div className="stat-card stat-card--dark"><span>MAX HEIGHT</span><strong id="heightMetric">00/16</strong></div>
          <div className="stat-card stat-card--accent"><span>BLOCKS</span><strong id="blockMetric">000</strong></div>
        </div>
        {/* The top ESP32 toolbar owns the connection indicator. Preserve the
            engine's legacy update hook, but don't repeat OFFLINE in Inspector. */}
        <span id="hardwareInputMetric" hidden aria-hidden="true">OFFLINE</span>
      </> : <div className="stats-grid">
        <div className="stat-card stat-card--light"><span>GRID</span><strong id="gridMetric">8×16</strong></div>
        <div className="stat-card stat-card--dark"><span>MAX HEIGHT</span><strong id="heightMetric">00/16</strong></div>
        <div className="stat-card stat-card--accent"><span>BLOCKS</span><strong id="blockMetric">000</strong></div>
      </div>}
      {mode !== 'hardware' && <div id="gridSettingsPopover" className="grid-settings-popover" hidden={true}>
        <div className="grid-settings-popover__head">
          <div>
            <span className="format-purpose">
              {"GRID SETTINGS"}
            </span>
            <span className="grid-settings-section-label">
              {"ACTIVE BUILD AREA"}
            </span>
          </div>
          <button id="closeGridSettings" className="grid-settings-close" type="button" aria-label="Close grid settings">
            {"×"}
          </button>
        </div>
        <div className="grid-adjust">
          <div className="grid-adjust__head">
            <span>
              {"BUILD AREA SIZE"}
            </span>
            <strong>
              <span id="gridSizeValue">
                {"08"}
              </span>
              {" / 08"}
            </strong>
          </div>
          <input id="gridSizeSlider" className="twin-range is-active" type="range" min="1" max="08" step="1" defaultValue="08" aria-label="Build area size from 1 by 2 to 8 by 16" />
          <div className="grid-adjust__scale" aria-hidden="true">
            <span>
              {"02×04"}
            </span>
            <span>
              {"05×10"}
            </span>
            <span>
              {"8×16"}
            </span>
          </div>
        </div>
      </div>}
    </aside>
  );
}
