import type { JSX } from 'react';

/** Preserved index layout — React owns this markup. */
export function ExportDialog(): JSX.Element {
  return (
    <section id="saveModal" className="save-modal" role="dialog" aria-modal="true" aria-labelledby="saveModalTitle" hidden={true}>
      <button id="saveModalBackdrop" className="save-modal__backdrop" type="button" aria-label="Close export panel"></button>
      <div className="save-modal__panel">
        <div className="save-modal__header">
          <div>
            <div className="panel-label">
              {"06 / EXPORT"}
            </div>
            <h2 id="saveModalTitle">
              {"EXPORT FOR "}
              <span>
                {"PRINT / 3D"}
              </span>
            </h2>
          </div>
          <button id="closeSaveModal" className="modal-close" type="button" aria-label="Close export panel">
            {"×"}
          </button>
        </div>
        <div className="save-modal__scroll">
          <p className="save-modal__intro">
            {"\n            Export a static mesh from the same surface you are previewing in the editor. Project saving is handled separately with the native Build It Live project file.\n          "}
          </p>
          <div className="export-model-view" aria-label="Current model view used for export">
            <span className="format-purpose">
              {"MODEL VIEW"}
            </span>
            <strong id="exportModelViewValue">
              {"BLOCKS"}
            </strong>
          </div>
          <div className="export-summary" aria-label="Export contents"><div><span>PROJECT</span><strong id="exportProjectName"></strong></div><div><span>DOWNLOAD NAME</span><strong id="exportFilenamePreview"></strong></div><p id="exportIncludedBlocks"></p></div>
          <section id="printabilityReport" className="printability-report" aria-label="3D printability preflight" aria-live="polite"></section>
          <div className="format-grid">
            <button className="format-card format-card--light" data-export-format="stl" type="button">
              <span className="format-index">
                {"01"}
              </span>
              <strong>
                {".STL"}
              </strong>
              <span className="format-purpose">
                {"3D PRINT"}
              </span>
              <p>
                {"Geometry-only print export with Standard Blocks only, positioned to match the web grid. Use 3MF when model colors must reach Bambu."}
              </p>
              <span className="format-action">
                {"EXPORT STL →"}
              </span>
            </button>
            <button className="format-card format-card--dark" data-export-format="glb" type="button">
              <span className="format-index">
                {"02"}
              </span>
              <strong>
                {".GLB"}
              </strong>
              <span className="format-purpose">
                {"3D SCENE"}
              </span>
              <p>
                {"Compact scene file with colors, scale, and reusable geometry for viewers and 3D tools."}
              </p>
              <span className="format-action">
                {"EXPORT GLB →"}
              </span>
            </button>
            <button className="format-card format-card--yellow" data-export-format="obj" type="button">
              <span className="format-index">
                {"03"}
              </span>
              <strong>
                {".OBJ"}
              </strong>
              <span className="format-purpose">
                {"3D SOFTWARE"}
              </span>
              <p>
                {"Geometry export for CAD and modelling workflows, aligned to the same voxel coordinate system."}
              </p>
              <span className="format-action">
                {"EXPORT OBJ →"}
              </span>
            </button>
            <button className="format-card format-card--bambu" data-export-format="3mf" type="button">
              <span className="format-index">
                {"04"}
              </span>
              <strong>
                {".3MF"}
              </strong>
              <span className="format-purpose">
                {"BAMBU / MULTICOLOR"}
              </span>
              <p>
                {"Print package that keeps Standard Block colors, including the current Smooth surface when Smooth is active."}
              </p>
              <span className="format-action">
                {"EXPORT 3MF →"}
              </span>
            </button>
          </div>
          <div className="save-modal__note">
            <strong>
              {"EXPORT = STATIC GEOMETRY"}
            </strong>
            <span>
              {"Use SAVE PROJECT for an editable .BIL file. Use 3MF for multicolor Bambu printing; STL remains geometry-only."}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
