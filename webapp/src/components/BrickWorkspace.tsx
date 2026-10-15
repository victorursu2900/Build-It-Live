import type { JSX } from 'react';
import { BrickStatus } from './BrickStatus';

/** Preserved brickmaker layout — React owns this markup. */
export function BrickWorkspace(): JSX.Element {
  return (
    <main className="brick-main">
      <section className="brick-panel brick-workspace" aria-labelledby="brickCanvasTitle">
        <div className="brick-section-head">
          <div>
            <span className="panel-label">
              {"01 / DRAW FOOTPRINT"}
            </span>
            <h2 id="brickCanvasTitle">
              {"DRAW THE BRICK"}
            </h2>
          </div>
          <div className="brick-tools" role="group" aria-label="Drawing tools">
            <button className="brick-tool is-active" data-brick-tool="draw" type="button" aria-pressed="true">
              {"DRAW"}
            </button>
            <button className="brick-tool" data-brick-tool="erase" type="button" aria-pressed="false">
              {"ERASE"}
            </button>
            <button id="brickClear" className="brick-tool brick-tool--clear" type="button">
              {"CLEAR"}
            </button>
          </div>
        </div>
        <div className="brick-grid-frame">
          <div id="brickGrid" className="brick-grid brick-grid--screw" role="grid" aria-label="8 by 16 layout grid, each cell is one 40 by 20 millimetre screw block"></div>
        </div>
        <p className="brick-hint">
          {"1 CELL = 1 SCREW BLOCK (40 × 20 MM) · CLICK + DRAG · "}
          <b>
            {"D"}
          </b>
          {" DRAW · "}
          <b>
            {"E"}
          </b>
          {" ERASE · "}
          <b>
            {"C"}
          </b>
          {" CLEAR"}
        </p>
      </section>
      <section className="brick-panel brick-preview-panel" aria-labelledby="brickPreviewTitle">
        <div className="brick-section-head brick-section-head--preview">
          <div>
            <span className="panel-label">
              {"02 / LIVE 3D"}
            </span>
            <h2 id="brickPreviewTitle">
              {"BRICK PREVIEW"}
            </h2>
          </div>
          <button id="brickPreviewFit" className="brick-tool" type="button">
            {"FIT VIEW"}
          </button>
        </div>
        <div id="brickPreview" className="brick-preview" role="img" aria-label="Interactive live 3D preview of the custom brick"></div>
        <p className="brick-hint">
          {"DRAG TO ORBIT 360° · VIEW UNDERSIDE · SCROLL TO ZOOM"}
        </p>
      </section>
      <aside className="brick-panel brick-summary" aria-label="Brick summary">
        <div className="brick-output-head">
          <span className="panel-label">03 / MODEL DATA</span>
          <h2>LIVE OUTPUT</h2>
        </div>
        <div className="brick-stats-grid">
          <div className="stat-card stat-card--light brick-stat">
            <span>
              {"BLOCKS"}
            </span>
            <strong id="studCount">
              {"000"}
            </strong>
          </div>
          <div className="stat-card stat-card--light brick-stat">
            <span>
              {"FOOTPRINT"}
            </span>
            <strong id="brickFootprint">
              {"00×00"}
            </strong>
          </div>
        </div>
        <div className="brick-specs">
          <div>
            <span>
              {"LIVE SIZE"}
            </span>
            <b id="brickDimensions">
              {"0 × 0 × 0 mm"}
            </b>
          </div>
          <div>
            <span>
              {"SOURCE BLOCK"}
            </span>
            <b id="brickModuleSpec">
              {"—"}
            </b>
          </div>
          <div>
            <span>
              {"PITCH"}
            </span>
            <b id="brickPitchSpec">
              {"—"}
            </b>
          </div>
          <div>
            <span>
              {"SOURCE STL"}
            </span>
            <b id="brickSourceSpec">
              {"blockScrew(1).stl"}
            </b>
          </div>
        </div>
        <BrickStatus />
        <div className="brick-output-actions">
          <button id="brickDownload" className="brick-primary" type="button" disabled={true}>
            {"DOWNLOAD STL"}
          </button>
        </div>
      </aside>
    </main>
  );
}
