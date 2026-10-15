/** Hardware-only configuration, preserved as semantic form markup.
 * Mounted synchronously before the original Three.js engine attaches listeners.
 */
import { useEffect } from 'react';



const markup = `    <section id="hardwareSetupModal" class="hardware-setup-modal" role="dialog" aria-modal="true"
      aria-labelledby="hardwareSetupTitle" aria-describedby="hardwareSetupDescription" hidden>
      <button id="hardwareSetupBackdrop" class="hardware-setup-modal__backdrop" type="button" aria-label="Close hardware menu"></button>
      <div class="hardware-setup-modal__panel">
        <div class="hardware-setup-modal__scroll">
        <div class="hardware-setup-modal__contents">
        <div class="hardware-setup-modal__header">
          <div>
            <div class="panel-label">SETUP / 01 — PHYSICAL INTERFACE</div>
            <h2 id="hardwareSetupTitle">HARDWARE <span>MODE</span></h2>
          </div>
          <button id="closeHardwareSetup" class="modal-close" type="button" aria-label="Close hardware menu">×</button>
        </div>
        <div class="hardware-setup-modal__intro">
          <p id="hardwareSetupDescription">Configure your sensor board and block resistance profiles.</p>
          <span id="hardwareModalStatus" class="hardware-setup-modal__status"><i aria-hidden="true"></i> CONFIGURATION</span>
        </div>
        <div id="hardwareModeTabs" class="hardware-mode-tabs" hidden style="display:none" aria-hidden="true">
          <button id="hardwareSettingsTab" type="button">01 / SETTINGS</button>
          <button id="hardwareSimulatorTab" type="button" hidden>02 / SIMULATOR</button>
        </div>
        <form id="hardwareSetupForm" class="hardware-setup-form">
          <fieldset class="hardware-setup-group">
            <legend><span>01 / SENSOR BOARD</span><small>ONE-TO-ONE MAPPING</small></legend>
            <div class="hardware-setup-grid hardware-setup-grid--physical">
              <label class="hardware-setup-field" for="hardwareBoardWidth">
                <span class="hardware-setup-field__head"><b>COLUMNS</b><em>01</em></span>
                <span class="hardware-setup-field__description">Cells across the physical plate.</span>
                <span class="hardware-setup-field__control">
                  <input id="hardwareBoardWidth" name="boardWidth" type="number" min="1" max="8" step="1" value="2" inputmode="numeric" required />
                  <span class="hardware-setup-field__unit">X</span>
                </span>
              </label>
              <label class="hardware-setup-field" for="hardwareBoardDepth">
                <span class="hardware-setup-field__head"><b>ROWS</b><em>02</em></span>
                <span class="hardware-setup-field__description">Cells along the physical plate.</span>
                <span class="hardware-setup-field__control">
                  <input id="hardwareBoardDepth" name="boardDepth" type="number" min="1" max="8" step="1" value="4" inputmode="numeric" required />
                  <span class="hardware-setup-field__unit">Y</span>
                </span>
              </label>
              <span class="hardware-setup-field__example hardware-grid-help">DIGITAL WORKSPACE MATCHES THE PHYSICAL GRID AUTOMATICALLY</span>

            </div>
          </fieldset>
          <fieldset class="hardware-setup-group">
            <legend><span>02 / BLOCK PROFILES</span><small>APPROXIMATE RESISTANCE / kΩ</small></legend>
            <div class="hardware-setup-grid hardware-setup-grid--profiles">
              <div class="hardware-setup-field hardware-setup-field--red">
                <div class="hardware-profile-core">
                  <label class="hardware-setup-field__head" for="hardwareStandardOhms"><b><i id="hardwareDefaultSwatch" class="hardware-setup-field__swatch"></i> STANDARD BLOCK</b><em>02</em></label>
                  <span class="hardware-setup-field__description">Map a resistor value to the default block color.</span>
                  <label class="hardware-setup-field__control" for="hardwareStandardOhms">
                    <input id="hardwareStandardOhms" type="number" min="0.1" max="10000" step="any" value="10" required />
                    <span class="hardware-setup-field__unit">kΩ</span>
                  </label>
                </div>
                <div class="hardware-profile-palette">
                  <div class="hardware-profile-colors">
                    <span>COLOR PALETTE</span>
                    <input type="color" id="hardwareDefaultColor" value="#e93222" aria-label="Standard block color" hidden />
                    <span id="hardwareDefaultHex" aria-live="polite">#E93222</span>
                  </div>
                  <div id="hardwareDefaultPaletteSlot" class="hardware-setup-palette-inline"></div>
                </div>
              </div>
              <label class="hardware-setup-field hardware-setup-field--black" for="hardwareSupportOhms">
                <span class="hardware-setup-field__head"><b><i class="hardware-setup-field__swatch"></i> SUPPORT BLOCK</b><em>03</em></span>
                <span class="hardware-setup-field__description">Sensor resistance for structural support blocks.</span>
                <span class="hardware-setup-field__control">
                  <input id="hardwareSupportOhms" type="number" min="0.1" max="10000" step="any" value="5.1" required />
                  <span class="hardware-setup-field__unit">kΩ</span>
                </span>
                <span class="hardware-setup-field__example">DEFAULT 05.1 kΩ / SUPPORT PROFILE</span>
              </label>
            </div>
            <div class="hardware-extra-heading"><span>MORE BLOCK PROFILES <small>UP TO 08</small></span><button id="hardwareAddProfile" type="button">+ ADD BLOCK</button></div>
            <div id="hardwareExtraProfiles" class="hardware-setup-grid hardware-extra-profiles" aria-live="polite"></div>
            <p class="hardware-resistance-note">Detection uses the closest resistance profile within ±25%. Calibrate actual sensor readings before working with the physical board.</p>
          </fieldset>
          <p id="hardwareSetupError" class="hardware-setup-error" role="alert" hidden></p>
          <div class="hardware-setup-form__footer">
            <p id="hardwareSetupFootnote">Starting a session clears the digital plate. You can edit settings while connected.</p>
            <div class="hardware-setup-form__actions">
              <button id="cancelHardwareSetup" class="hardware-setup-button hardware-setup-button--cancel" type="button">CANCEL</button>
              <button class="hardware-setup-button hardware-setup-button--submit" type="submit"><span id="hardwareSubmitLabel">START HARDWARE MODE</span> <span aria-hidden="true">↗</span></button>
            </div>
          </div>
        </form>
        <!-- Inert compatibility nodes for the existing ESP32 engine. No simulator UI in this hardware edition. -->
        <div id="hardwareSimulationPanel" hidden style="display:none" inert aria-hidden="true">
          <div id="hardwareSimulatorPreflight" hidden><span id="hardwareSimulatorPreviewText"></span><button id="hardwareSimulatorStart" type="button"></button></div>
          <div id="hardwareSimCells"></div>
          <select id="hardwareSimProfile"></select>
          <input id="hardwareSimResistance" type="number" value="10" />
          <button id="hardwareSimAdd" type="button"></button>
          <button id="hardwareSimRemove" type="button"></button>
          <button id="hardwareSimClear" type="button"></button>
          <span id="hardwareSimFeedback"></span>
        </div>
        </div>
        </div>
        <div class="hardware-setup-modal__scrollbar" aria-hidden="true" hidden>
          <div class="hardware-setup-modal__scrollbar-thumb"></div>
        </div>
      </div>
    </section>`;
/** Visually inset scrollbar. The browser's native scrolling, wheel, keys, and touch
 * remain intact. Only the visible rail/drag thumb are custom so the track can have
 * real top/bottom margins and will not touch the rounded dialog edges. */
export function HardwareSetup() {
  useEffect(() => {
    const modal = document.getElementById('hardwareSetupModal');
    const scroller = modal?.querySelector<HTMLElement>('.hardware-setup-modal__scroll');
    const contents = modal?.querySelector<HTMLElement>('.hardware-setup-modal__contents');
    const track = modal?.querySelector<HTMLElement>('.hardware-setup-modal__scrollbar');
    const thumb = track?.querySelector<HTMLElement>('.hardware-setup-modal__scrollbar-thumb');
    if (!modal || !scroller || !contents || !track || !thumb) return;

    let raf = 0;
    let dragging: number | null = null;
    let pointerOffset = 0;
    const sync = () => {
      raf = 0;
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      track.hidden = modal.hidden || maxScroll <= 2;
      if (track.hidden) return;
      const rail = track.clientHeight;
      const length = Math.min(rail, Math.max(42, rail * scroller.clientHeight / scroller.scrollHeight));
      thumb.style.height = `${length}px`;
      thumb.style.transform = `translateY(${maxScroll ? (scroller.scrollTop / maxScroll) * (rail - length) : 0}px)`;
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(sync); };
    const thumbSize = () => thumb.getBoundingClientRect().height;
    const setPosition = (pointerY: number) => {
      const rect = track.getBoundingClientRect();
      const maxThumbTravel = Math.max(0, rect.height - thumbSize());
      const offset = Math.max(0, Math.min(maxThumbTravel, pointerY - rect.top - pointerOffset));
      scroller.scrollTop = maxThumbTravel ? offset / maxThumbTravel * (scroller.scrollHeight - scroller.clientHeight) : 0;
      schedule();
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = event.pointerId;
      const thumbRect = thumb.getBoundingClientRect();
      pointerOffset = thumb.contains(event.target as Node) ? event.clientY - thumbRect.top : thumbRect.height / 2;
      track.setPointerCapture(event.pointerId);
      setPosition(event.clientY);
    };
    const pointerMove = (event: PointerEvent) => { if (event.pointerId === dragging) setPosition(event.clientY); };
    const pointerUp = (event: PointerEvent) => {
      if (event.pointerId === dragging) dragging = null;
    };
    track.addEventListener('pointerdown', pointerDown);
    track.addEventListener('pointermove', pointerMove);
    track.addEventListener('pointerup', pointerUp);
    track.addEventListener('pointercancel', pointerUp);
    scroller.addEventListener('scroll', schedule, { passive: true });
    const sizeObserver = new ResizeObserver(schedule);
    [scroller, contents, track].forEach((element) => sizeObserver.observe(element));
    const visibilityObserver = new MutationObserver(schedule);
    visibilityObserver.observe(modal, { attributes: true, attributeFilter: ['hidden', 'class'] });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      sizeObserver.disconnect();
      visibilityObserver.disconnect();
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      track.removeEventListener('pointerdown', pointerDown);
      track.removeEventListener('pointermove', pointerMove);
      track.removeEventListener('pointerup', pointerUp);
      track.removeEventListener('pointercancel', pointerUp);
    };
  }, []);
  return <>
    <div className="hardware-dialog-root" dangerouslySetInnerHTML={{ __html: markup }} />
  </>;
}
