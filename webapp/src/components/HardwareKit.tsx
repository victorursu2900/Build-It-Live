import { BlockColorPicker } from './BlockColorPicker';
import { HardwareWorkbenchTools } from './HardwareWorkbenchTools';

/** Physical-first controls: the engine supplies bricks from ESP32 sensor frames.
 * A hidden loading hook remains only for the shared legacy engine; Hardware
 * Builder has no Load Project control.
 */

export function HardwareKit() {
  return <aside className="tool-panel hardware-kit" aria-label="Model appearance and project files">
    <section className="hardware-kit__appearance" aria-label="Model colors">
      {/* Retain the engine's existing color/tool sync hooks without a second visible trigger. */}
      <button data-tool="standard" type="button" hidden tabIndex={-1} aria-hidden="true" style={{ display: 'none' }}>
        <span id="standardColorSwatch" />
      </button>
      <BlockColorPicker embedded />
    </section>
    <HardwareWorkbenchTools placement="calibration" />
    <section className="buildkit-files hardware-kit__files" aria-labelledby="hardwareFilesHeading">
      <h3 id="hardwareFilesHeading" className="hardware-section-heading">PROJECT FILES</h3>
      <div className="panel-actions panel-actions--files project-file-actions">
        <button id="saveBuild" className="secondary-button secondary-button--primary" type="button">SAVE PROJECT</button>
        <button id="exportBuild" className="secondary-button project-export-button" type="button">EXPORT</button>
        <button id="openStudioTools" className="secondary-button studio-tools-trigger" type="button">STUDIO TOOLS ↗</button>
      </div>
      <HardwareWorkbenchTools placement="capture" />
      {/* Internal legacy bindings; not interactive or visible in Hardware Builder. */}
      <div hidden style={{ display: 'none' }} aria-hidden="true" inert>
        <button id="loadBuild" type="button" tabIndex={-1} />
      </div>
      <div className="panel-actions panel-actions--small">
        <button id="resetView" className="secondary-button" type="button">RESET VIEW</button>
        <button id="clearBuild" title="Clearing is paused during active ESP32 sessions" className="secondary-button secondary-button--danger" type="button">CLEAR BUILD</button>
      </div>
    </section>
  </aside>;
}
