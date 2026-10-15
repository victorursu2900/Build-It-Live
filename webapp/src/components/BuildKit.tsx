import type { JSX } from 'react';

/** Preserved index layout — React owns this markup. */
export function BuildKit(): JSX.Element {
  return (
    <aside className="tool-panel" aria-label="Block tools">
      <div className="buildkit-create">
      <div className="panel-intro">
        <div className="panel-label">
          {"01 / BUILD KIT"}
        </div>
        <div className="panel-intro__heading-row">
          <h2>
            {"Pick a block."}
            <br />
            {"Build a form."}
          </h2>
          <button id="freeMoveButton" className="free-move-button free-move-button--heading" type="button" aria-pressed="false" title="Camera-only mode. Drag to orbit without placing or erasing blocks.">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M22 12l-3-3M22 12l-3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3"></path>
            </svg>
            <span>
              {"FREE MOVE"}
            </span>
            <kbd>
              {"M"}
            </kbd>
          </button>
        </div>
      </div>
      <div className="tool-stack">
        <button className="tool-button is-active" data-tool="standard" type="button" aria-haspopup="dialog" aria-expanded="false">
          <span className="tool-index">
            {"01"}
          </span>
          <span id="standardColorSwatch" className="tool-swatch swatch-standard"></span>
          <span className="tool-copy">
            <strong>
              {"STANDARD BLOCK"}
            </strong>
            <small>
              {"Solid block · tap again to choose a color"}
            </small>
          </span>
          <kbd>
            {"1"}
          </kbd>
        </button>
        <button className="tool-button" data-tool="support" type="button">
          <span className="tool-index">
            {"02"}
          </span>
          <span className="tool-swatch swatch-support"></span>
          <span className="tool-copy">
            <strong>
              {"SUPPORT BLOCK"}
            </strong>
            <small>
              {"Temporary helper block for stacking"}
            </small>
          </span>
          <kbd>
            {"2"}
          </kbd>
        </button>
        <button className="tool-button" data-tool="eraser" type="button">
          <span className="tool-index">
            {"03"}
          </span>
          <span className="tool-swatch swatch-eraser">
            {"×"}
          </span>
          <span className="tool-copy">
            <strong>
              {"ERASER"}
            </strong>
            <small>
              {"Remove a block and drop the stack"}
            </small>
          </span>
          <kbd>
            {"E"}
          </kbd>
        </button>
      </div>
      </div>
      <div className="buildkit-files" aria-labelledby="digitalFilesHeading">
      <h3 id="digitalFilesHeading" className="project-files-heading">PROJECT FILES</h3>
      <div className="panel-actions panel-actions--files project-file-actions">
        <button id="exportBuild" className="secondary-button project-export-button" type="button">
          {"EXPORT"}
        </button>
        <button id="loadBuild" className="secondary-button" type="button">
          {"LOAD PROJECT"}
        </button>
        <button id="saveBuild" className="secondary-button secondary-button--primary" type="button">
          {"\n            SAVE PROJECT\n          "}
        </button>
        <button id="openStudioTools" className="secondary-button studio-tools-trigger" type="button">STUDIO TOOLS ↗</button>
      </div>
      <div className="panel-actions panel-actions--small">
        <button id="resetView" className="secondary-button" type="button">
          {"RESET VIEW"}
        </button>
        <button id="clearBuild" className="secondary-button secondary-button--danger" type="button">
          {"\n            CLEAR BUILD\n          "}
        </button>
      </div>
      </div>
    </aside>
  );
}
