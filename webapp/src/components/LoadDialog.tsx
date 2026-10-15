import type { JSX } from 'react';

/** Preserved index layout — React owns this markup. */
export function LoadDialog(): JSX.Element {
  return (
    <section id="loadModal" className="load-modal" role="dialog" aria-modal="true" aria-labelledby="loadModalTitle" hidden={true}>
      <button id="loadModalBackdrop" className="load-modal__backdrop" type="button" aria-label="Close load panel"></button>
      <input id="loadBuildInput" className="visually-hidden" type="file" accept=".bil,.json,.stl,.glb,.obj" aria-label="Choose a Build It Live project file" />
      <div className="load-modal__panel">
        <div className="load-modal__header">
          <div>
            <div className="panel-label">
              {"05 / OPEN PROJECT"}
            </div>
            <h2 id="loadModalTitle">
              {"LOAD YOUR "}
              <span>
                {"PROJECT"}
              </span>
            </h2>
          </div>
          <button id="closeLoadModal" className="modal-close" type="button" aria-label="Close load panel">
            {"×"}
          </button>
        </div>
        <div className="load-modal__body">
          <div className="load-modal__copy">
            <p>
              {"Load .BIL for exact editing. STL preserves the mesh."}
            </p>
            <div id="loadDropZone" className="load-dropzone" tabIndex={0} role="button" aria-label="Drop a saved model file here or choose a format below">
              <span className="load-dropzone__index">
                {"DROP"}
              </span>
              <strong>
                {"DROP FILE HERE"}
              </strong>
              <span>
                {".BIL / LEGACY JSON / GLB / OBJ / STL"}
              </span>
            </div>
          </div>
          <div className="load-format-grid">
            <button className="load-format-card load-format-card--project" data-load-format="bil" type="button">
              <span className="format-index">
                {"01"}
              </span>
              <strong>
                {".BIL"}
              </strong>
              <span className="format-purpose">
                {"NATIVE EDITABLE PROJECT"}
              </span>
              <p>
                {"Exact blocks, colors, grid, view, and camera."}
              </p>
              <span className="format-action">
                {"OPEN PROJECT →"}
              </span>
            </button>
            <button className="load-format-card load-format-card--accent" data-load-format="json" type="button">
              <span className="format-index">
                {"02"}
              </span>
              <strong>
                {".JSON"}
              </strong>
              <span className="format-purpose">
                {"LEGACY EDITABLE STATE"}
              </span>
              <p>
                {"Legacy editable blocks and settings."}
              </p>
              <span className="format-action">
                {"OPEN LEGACY JSON →"}
              </span>
            </button>
            <button className="load-format-card load-format-card--dark" data-load-format="glb" type="button">
              <span className="format-index">
                {"03"}
              </span>
              <strong>
                {".GLB"}
              </strong>
              <span className="format-purpose">
                {"LEGACY GLB RECOVERY"}
              </span>
              <p>
                {"Older GLB files with editable data."}
              </p>
              <span className="format-action">
                {"CHOOSE LEGACY GLB →"}
              </span>
            </button>
            <button className="load-format-card load-format-card--yellow" data-load-format="obj" type="button">
              <span className="format-index">
                {"04"}
              </span>
              <strong>
                {".OBJ"}
              </strong>
              <span className="format-purpose">
                {"LEGACY OBJ RECOVERY"}
              </span>
              <p>
                {"Older OBJ files with editable data."}
              </p>
              <span className="format-action">
                {"CHOOSE LEGACY OBJ →"}
              </span>
            </button>
            <button className="load-format-card load-format-card--light" data-load-format="stl" type="button">
              <span className="format-index">
                {"05"}
              </span>
              <strong>
                {".STL"}
              </strong>
              <span className="format-purpose">
                {"OPEN 3D MESH"}
              </span>
              <p>
                {"Original mesh; cubes restored only if saved."}
              </p>
              <span className="format-action">
                {"CHOOSE STL →"}
              </span>
            </button>
          </div>
        </div>
        <div className="load-modal__note">
          <strong>
            {"NATIVE WORKFLOW → SAVE / LOAD .BIL"}
          </strong>
          <span>
            {"Use .BIL for guaranteed, portable editing."}
          </span>
        </div>
      </div>
    </section>
  );
}
