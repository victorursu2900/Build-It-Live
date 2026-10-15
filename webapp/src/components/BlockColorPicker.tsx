import type { JSX, CSSProperties } from 'react';

/** Preserved index layout — React owns this markup. */
export function BlockColorPicker({ embedded = false }: { embedded?: boolean }): JSX.Element {
  return (
    <div id="blockColorPopover" className={embedded ? 'block-color-popover hardware-color-inline is-open' : 'block-color-popover'} role={embedded ? 'group' : 'dialog'} aria-label={embedded ? 'Model colors' : 'Choose block color'} hidden={!embedded}>
      <div className="block-color-popover__head">
        <div className="block-color-popover__title">
          {!embedded && <span>BLOCK COLOR / 01</span>}
          <strong>{embedded ? "MODEL COLORS" : "COLOR LIBRARY"}</strong>
        </div>
        <div className="block-color-popover__head-tools">
          {!embedded && <button type="button" id="colorEyedropperToggle" className="block-color-eyedropper__trigger" aria-label="Eyedropper: sample a block color" aria-pressed="false" aria-describedby="colorEyedropperHint" title="Eyedropper — pick a block color">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 22 1.5-5 10.7-10.7"/><path d="m15.6 3.9 4.5 4.5"/><path d="M18.2 2.1a2.5 2.5 0 0 1 3.5 3.5l-6.1 6.1-4.5-4.5z"/><path d="M4 17.5 6.5 20"/></svg>
            <span id="colorEyedropperAction" className="block-color-eyedropper__sr">PICK FROM MODEL</span>
            <i id="colorEyedropperSwatch" className="block-color-eyedropper__swatch" aria-hidden="true" />
          </button>}
          <div className="block-color-current" aria-label="Current block color">
            <i id="blockColorCurrentSwatch" aria-hidden="true" />
            <strong id="blockColorName">RED</strong>
          </div>
        </div>
      </div>
      {!embedded && <p id="colorEyedropperHint" className="block-color-eyedropper__hint" aria-live="polite" hidden>Click a Standard Block to sample its color; then click others to paint. Escape to finish.</p>}
      <div className="block-color-target" role="group" aria-label="Where to apply the chosen color">
        <span>
          {embedded ? "APPLY TO" : "APPLY COLOR TO"}
        </span>
        <div className="block-color-target__buttons">
          {!embedded && <button className="block-color-target__button is-active" type="button" data-color-target="new" aria-pressed="true">
            <strong>
              {"NEW"}
            </strong>
            <small>
              {"BLOCKS"}
            </small>
          </button>}
          <button className="block-color-target__button" type="button" data-color-target="selected" aria-pressed="false">
            <strong>
              {"SELECTED"}
            </strong>
            <small>
              <span id="recolorSelectedCount">
                {"00"}
              </span>
              {" BLOCKS"}
            </small>
          </button>
          <button className={`block-color-target__button${embedded ? ' is-active' : ''}`} type="button" data-color-target="all" aria-pressed={embedded}>
            <strong>
              {"ENTIRE"}
            </strong>
            <small>
              {"MODEL"}
            </small>
          </button>
        </div>
      </div>
      <p id="blockColorTargetHint" className="block-color-scope-hint" aria-live="polite" hidden={true}></p>
      <div className="block-color-scope-spacer" aria-hidden="true" />
      <div className="color-palette-caption"><span>{embedded ? 'COLOR PALETTE' : '02 / COLOR PALETTE'}</span><span>{embedded ? '9 + CUSTOM' : '09 COLORS + CUSTOM'}</span></div>
      <div className="block-color-grid" role="group" aria-label="Block colors">
        <button className="block-color-choice block-color-choice--standard is-active" type="button" data-block-color="#e93222" data-color-name="Standard" aria-label="Standard color" title="Standard color" style={{"--block-color": "#e93222"} as CSSProperties}>
          <span>
            {"DEFAULT"}
          </span>
        </button>
        <button className="block-color-choice" type="button" data-block-color="#ff7a30" data-color-name="Orange" aria-label="Orange" title="Orange" style={{"--block-color": "#ff7a30"} as CSSProperties}></button>
        <button className="block-color-choice" type="button" data-block-color="#f2c94c" data-color-name="Yellow" aria-label="Yellow" title="Yellow" style={{"--block-color": "#f2c94c"} as CSSProperties}></button>
        <button className="block-color-choice" type="button" data-block-color="#27ae60" data-color-name="Green" aria-label="Green" title="Green" style={{"--block-color": "#27ae60"} as CSSProperties}></button>
        <button className="block-color-choice" type="button" data-block-color="#2f80ed" data-color-name="Blue" aria-label="Blue" title="Blue" style={{"--block-color": "#2f80ed"} as CSSProperties}></button>
        <button className="block-color-choice" type="button" data-block-color="#9b51e0" data-color-name="Purple" aria-label="Purple" title="Purple" style={{"--block-color": "#9b51e0"} as CSSProperties}></button>
        <button className="block-color-choice" type="button" data-block-color="#ff6fae" data-color-name="Pink" aria-label="Pink" title="Pink" style={{"--block-color": "#ff6fae"} as CSSProperties}></button>
        <button className="block-color-choice" type="button" data-block-color="#f4f1e8" data-color-name="White" aria-label="White" title="White" style={{"--block-color": "#f4f1e8"} as CSSProperties}></button>
        <button className="block-color-choice" type="button" data-block-color="#171717" data-color-name="Black" aria-label="Black" title="Black" style={{"--block-color": "#171717"} as CSSProperties}></button>
        <button id="customColorToggle" className="block-color-custom" type="button" aria-expanded="false" aria-pressed="false" aria-controls="customColorPanel" aria-label="Custom color" title="Custom color">
          <span className="block-color-custom__label">
            {"CUSTOM"}
          </span>
        </button>
      </div>
      <div id="customColorPanel" className="custom-color-panel" hidden={true}>
        <div className="custom-color-panel__head">
          <div>
            <span>
              {embedded ? "FINE TUNE" : "03 / FINE TUNE"}
            </span>
            <strong>
              {"COLOR MIXER"}
            </strong>
          </div>
          <button id="customColorClose" className="custom-color-close" type="button" aria-label="Close custom color menu">
            {"×"}
          </button>
        </div>
        <div className="custom-color-preview-row">
          <span id="customColorPreview" className="custom-color-preview" aria-hidden="true"></span>
          <label className="custom-color-hex-wrap">
            <span>
              {"HEX"}
            </span>
            <input id="customColorHex" className="custom-color-hex" type="text" defaultValue="#E93222" maxLength={7} spellCheck="false" aria-label="Custom color hex value" />
          </label>
        </div>
        <div className="custom-color-controls">
          <label className="custom-color-control custom-color-control--hue">
            <span>
              {"HUE"}
            </span>
            <input id="customHue" type="range" min="0" max="360" defaultValue="5" aria-label="Hue" />
          </label>
          <label className="custom-color-control custom-color-control--sat">
            <span>
              {"SAT"}
            </span>
            <input id="customSaturation" type="range" min="0" max="100" defaultValue="81" aria-label="Color intensity" />
          </label>
          <label className="custom-color-control custom-color-control--light">
            <span>
              {"LIGHT"}
            </span>
            <input id="customLightness" type="range" min="8" max="92" defaultValue="52" aria-label="Lightness" />
          </label>
        </div>
        <button id="customColorApply" className="custom-color-apply" type="button">
          {"USE THIS COLOR"}
        </button>
      </div>
    </div>
  );
}
