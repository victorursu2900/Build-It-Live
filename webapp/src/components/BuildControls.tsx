import type { JSX } from 'react';
import type { BuilderMode } from '../domain/builderMode';

/** Preserved index layout — React owns this markup. */
export function BuildControls({ mode = 'digital' }: { mode?: BuilderMode }): JSX.Element {
  return (
    <aside className="feature-panel" aria-label="Build controls">
      <div className="panel-label">
        {mode === 'hardware' ? '04 / CONTROL DECK' : '03 / CONTROL DECK'}
      </div>
      <div className="feature-section render-controls">
        <div className="feature-heading">
          <span>
            {"MODEL VIEW"}
          </span>
          <strong id="realtimeRenderStatus" className={mode === 'hardware' ? 'hardware-view-state' : undefined}>
            {"BLOCKS"}
          </strong>
        </div>
        <div className="render-mode-buttons" role="group" aria-label="Live model surface">
          <button className="render-mode-button is-active" data-live-surface="voxel" type="button" aria-pressed="true">
            {"BLOCKS"}
          </button>
          <button className="render-mode-button" data-live-surface="soft1" type="button" aria-pressed="false">
            {"SMOOTH"}
          </button>
        </div>
        <div id="realtimeSmoothingControls" className="realtime-smoothing" hidden={true}>
          <div className="realtime-smoothing__head">
            <span>
              {"SMOOTHNESS"}
            </span>
            <strong>
              <span id="realtimeSmoothingValue">
                {"03"}
              </span>
              {" / 05"}
            </strong>
          </div>
          <input id="realtimeSmoothingSlider" className="twin-range is-active" type="range" min="1" max="5" step="1" defaultValue="3" aria-label="Smoothness level from one to five" />
          <div className="smooth-profile-header">EDGE PROFILE</div>
          <div className="smooth-profile-switch" role="group" aria-label="Smooth edge profile">
            <button type="button" data-smooth-edge-profile="classic" className="smooth-profile-button is-active" aria-pressed="true">CLASSIC</button>
            <button type="button" data-smooth-edge-profile="rounded" className="smooth-profile-button" aria-pressed="false">ROUNDED</button>
          </div>
          <small id="smoothEdgeProfileHint" className="smooth-profile-caption">Original smooth geometry. Sharp level changes are preserved.</small>
          <button id="smoothOriginalOutline" className="feature-button smooth-outline-toggle" type="button" aria-pressed="false">COMPARE ORIGINAL OUTLINE</button>
          <small className="smooth-preview-help">Live preview matches export quality. Compare overlays original block edges.</small>
          <div className="realtime-smoothing__meta">
            <span id="realtimeSmoothingState" role="status" aria-live="polite">
              {"READY"}
            </span>
          </div>
        </div>
      </div>
      <div className="feature-section continuous-controls" hidden={mode === 'hardware'} style={mode === 'hardware' ? {display: 'none'} : undefined}>
        <div className="feature-heading">
          <span>
            {"CONTINUOUS BUILD"}
          </span>
          <button id="continuousToggle" className="autosave-toggle" type="button" role="switch" aria-checked="false" aria-label="Toggle continuous build mode">
            <span className="autosave-toggle__track" aria-hidden="true">
              <i></i>
            </span>
            <span id="continuousStatus" className="autosave-state">
              {"OFF"}
            </span>
          </button>
        </div>
        <small className="continuous-hint">
          {"ALT + LEFT DRAG → ORBIT CAMERA"}
        </small>
      </div>
      <div className="feature-section autosave-controls">
        <div className="feature-heading">
          <span>
            {"AUTOSAVE"}
          </span>
          <button id="autosaveToggle" className="autosave-toggle is-on" type="button" role="switch" aria-checked="true" aria-label="Toggle autosave">
            <span className="autosave-toggle__track" aria-hidden="true">
              <i></i>
            </span>
            <span id="autosaveStatus" className="autosave-state">
              {"ON"}
            </span>
          </button>
        </div>
        <div className="autosave-row">
          <span id="autosaveMeta" className="autosave-meta">
            {"Waiting for changes"}
          </span>
          <button id="openRecentModels" className="feature-button" type="button">
            {"RECENT MODELS"}
          </button>
        </div>
      </div>
      <div className="feature-section layer-controls">
        <div className="feature-heading">
          <span>
            {"LAYER VIEW"}
          </span>
          <strong id="layerValue">
            {"ALL"}
          </strong>
        </div>
        <div className="layer-row">
          <button id="showAllLayers" className="layer-all is-active" type="button">
            {"ALL"}
          </button>
          <input id="layerSlider" className="twin-range" type="range" min="0" max="16" step="1" defaultValue="0" aria-label="Show build up to selected layer; zero shows all layers" />
        </div>
        <div className="layer-scale" aria-hidden="true">
          <span>
            {"01"}
          </span>
          <span>
            {"08"}
          </span>
          <span>
            {"16"}
          </span>
        </div>
      </div>
    </aside>
  );
}
