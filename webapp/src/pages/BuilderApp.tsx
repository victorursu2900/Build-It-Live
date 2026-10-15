import { useEffect, useState } from 'react';
import { BuilderHeader } from '../components/BuilderHeader';
import { BuildViewport } from '../components/BuildViewport';
import { BuildKit } from '../components/BuildKit';
import { HardwareKit } from '../components/HardwareKit';
import type { BuilderMode } from '../domain/builderMode';
import { BlockColorPicker } from '../components/BlockColorPicker';
import { LiveStats } from '../components/LiveStats';
import { BuildControls } from '../components/BuildControls';
import { LiveFeedback } from '../components/LiveFeedback';
import { ExportDialog } from '../components/ExportDialog';
import { LoadDialog } from '../components/LoadDialog';
import { RecentModelsDialog } from '../components/RecentModelsDialog';
import { ProjectActionDialog } from '../components/ProjectActionDialog';
import { HelpBar } from '../components/HelpBar';
import { HardwareSetup } from '../components/HardwareSetup';
import { HardwareWorkbenchTools } from '../components/HardwareWorkbenchTools';
import { installRailBounce } from '../ui/railBounce';
import { installRailOverflow } from '../ui/railOverflow';

type MobileSection = 'canvas' | 'tools' | 'inspector';

/** The existing Three.js engine is mounted into a dedicated, resizable workspace. */
export function BuilderApp({ mode = 'digital' }: { mode?: BuilderMode }) {
  const hardware = mode === 'hardware';
  const [mobileSection, setMobileSection] = useState<MobileSection>('canvas');
  const [leftOpen, setLeftOpen] = useState(true);
  const [isCompact, setIsCompact] = useState(() => window.matchMedia('(max-width: 860px)').matches);
  const [rightOpen, setRightOpen] = useState(true);
  // Keep the 3D scene mounted throughout each rail animation. The CSS grid
  // transitions its columns; neither sidebar is unmounted while sliding.
  const toggleRail = (rail: 'tools' | 'inspector', open: boolean) => {
    if (rail === 'tools') setLeftOpen(open);
    else setRightOpen(open);
  };
  const [sceneFeedback, setSceneFeedback] = useState({ title: hardware ? 'AWAITING HARDWARE' : 'PLACE ON BASE', text: hardware ? 'Connect ESP32 to receive the physical model.' : 'Choose a tool, then click a cell.' });

  useEffect(() => {
    // Legacy engine owns the feedback nodes; mirror their changes in the mobile viewport
    // so feedback stays visible while the inspector is closed.
    const title = document.getElementById('feedbackTitle');
    const description = document.getElementById('feedbackText');
    if (!title || !description) return;
    const sync = () => {
      setSceneFeedback({ title: title.textContent?.trim() || (hardware ? 'AWAITING HARDWARE' : 'BUILD READY'), text: description.textContent?.trim() || '' });
    };
    const observer = new MutationObserver(sync);
    [title, description].forEach((node) => observer.observe(node, { childList: true, subtree: true, characterData: true }));
    sync();
    return () => observer.disconnect();
  }, []);

  useEffect(() => { void import('../engine/builderEngine'); }, []);
  // Independent, passive rail-edge feedback; engine/canvas scrolling is unaffected.
  useEffect(() => {
    const root = document.getElementById('app');
    const cleanupOverflow = installRailOverflow(root);
    const cleanupBounce = installRailBounce(root);
    return () => { cleanupBounce(); cleanupOverflow(); };
  }, []);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 860px)');
    const sync = () => setIsCompact(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  // The Three.js viewport has its own ResizeObserver. Avoid dispatching extra
  // resize events mid-layout: they previously caused a visible flicker.

  return (
    <div id="app" className={`studio-app ${hardware ? 'hardware-builder' : 'digital-builder'} ${leftOpen ? '' : 'tools-collapsed'} ${rightOpen ? '' : 'inspector-collapsed'}`} data-mobile-section={mobileSection}>
      <BuilderHeader mode={mode} />
      <div className="studio-workspace">
        <section className="studio-sidebar studio-sidebar--tools" aria-label={hardware ? "Hardware workbench" : "Building tools"}>
          <div className="studio-rail-heading">
            <div><span className="studio-overline">{hardware ? '01 / HARDWARE' : '01 / CREATE'}</span><h2>{hardware ? 'WORKBENCH' : 'BUILD KIT'}</h2></div>
            <button className="rail-collapse" type="button" onClick={() => { if (isCompact) setMobileSection('canvas'); else toggleRail('tools', false); }} aria-label="Collapse tools" title="Collapse tools"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 12H5m7-7-7 7 7 7" /></svg></button>
          </div>
          <div className="studio-rail-scroll">{hardware ? <HardwareKit /> : <BuildKit />}</div>
          <div className="studio-rail-foot"><span className="studio-pulse" /> {hardware ? 'SENSOR MODE' : 'BUILD MODE'} <span className="studio-foot-detail">{hardware ? '/ PHYSICAL INPUT' : '/ EDITABLE'}</span></div>
        </section>

        <section className="studio-scene" aria-label="3D build workspace">
          <div className="studio-canvas-toolbar">
            <div className="canvas-tools-area">
              {((isCompact && mobileSection !== 'tools') || (!isCompact && !leftOpen)) && (
                <button className="studio-canvas-toggle" type="button"
                  onClick={() => { if (isCompact) setMobileSection('tools'); else toggleRail('tools', true); }}
                  aria-label={hardware ? "Show hardware tools" : "Show Build Kit"} title={hardware ? "Show hardware tools" : "Show Build Kit"}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M5.7 8h.7M5.7 12h.7M5.7 16h.7" strokeWidth="2" strokeLinecap="round"/></svg>
                  <span>{hardware ? 'WORKBENCH' : 'BUILD KIT'}</span>
                </button>
              )}
              <div className="canvas-identity"><span className="studio-pulse" /><span>{'SCENE / 01'}</span><strong>{hardware ? 'PHYSICAL MODEL' : '3D WORKSPACE'}</strong></div>
            </div>
            <div className="canvas-utilities">
              <span className="canvas-view-label">PERSPECTIVE VIEW</span>
              <div className="model-size-control">
                <button id="modelDimensionsToggle" className="model-size-toggle" type="button" aria-pressed="false" aria-controls="modelMeasurementsCard" aria-label="Show model dimensions">SIZE</button>
              </div>
              {((isCompact && mobileSection !== 'inspector') || (!isCompact && !rightOpen)) && (
                <button className="studio-canvas-toggle" type="button"
                  onClick={() => { if (isCompact) setMobileSection('inspector'); else toggleRail('inspector', true); }}
                  aria-label="Show inspector" title="Show inspector">
                  <span>INSPECTOR</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M17.5 8h1.5M17.5 12h1.5M17.5 16h1.5" strokeWidth="2" strokeLinecap="round"/></svg>
                </button>
              )}
            </div>
          </div>
          <div id="smoothLoadingIndicator" className="smooth-loading-indicator" role="status" aria-live="polite" hidden={true}>
            <span id="smoothLoadingLabel">PREPARING SMOOTH VIEW</span>
            <div className="smooth-loading-track" role="progressbar" aria-label="Generating Smooth view" aria-valuetext="Smoothing in progress"><i /></div>
          </div>
          <svg id="modelMeasurementsSvg" className="model-measurements-svg" role="img" aria-label="Model width, depth and height" aria-hidden="true" style={{display:'none'}} />
          <div id="modelMeasurementsCard" className="model-measurements-card" hidden><span>WHOLE MODEL SIZE / W · D · H</span><strong id="modelDimensionsValues"></strong><button id="measurementUnits" type="button">MM / switch to cells</button></div>
          <BuildViewport />
          {!hardware && <div className="workspace-layer-controls">
            <button id="editLayerToggle" className="feature-button workspace-layer-edit" type="button" aria-pressed="false" hidden={true}>EDIT THIS LAYER / OFF</button>
            <div id="layerRepairNotice" className="layer-repair-notice" role="alert" hidden={true}><strong>REPLACEMENT BLOCK REQUIRED</strong><span id="layerRepairText"></span><button id="repairLayerSupport" className="feature-button" type="button">SHOW MISSING CELL</button></div>
          </div>}

          <div className="studio-mobile-feedback" role="status" aria-live="polite"><strong>{sceneFeedback.title}</strong><span>{sceneFeedback.text}</span></div>
          <div className="studio-shortcuts">{hardware ? <footer className="helpbar"><span><b>DRAG</b> orbit</span><span><b>RIGHT DRAG</b> pan</span><span><b>SCROLL</b> zoom</span><span><b>ESP32</b> input</span></footer> : <HelpBar />}</div>
        </section>

        <section className="studio-sidebar studio-sidebar--inspector" aria-label="Model inspector">
          <div className="studio-rail-heading">
            <div><span className="studio-overline">{hardware ? '02 / MONITOR' : '02 / REFINE'}</span><h2>INSPECTOR</h2></div>
            <button className="rail-collapse" type="button" onClick={() => { if (isCompact) setMobileSection('canvas'); else toggleRail('inspector', false); }} aria-label="Collapse inspector" title="Collapse inspector"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14m-7-7 7 7-7 7" /></svg></button>
          </div>
          <div className="studio-rail-scroll"><div className="studio-inspector-content"><LiveStats mode={mode} />{hardware && <HardwareWorkbenchTools placement="diagnostics" />}<LiveFeedback mode={mode} /><BuildControls mode={mode} /></div></div>
          <div className="studio-rail-foot">MODEL STATUS <span className="studio-foot-detail">/ AUTO-UPDATED</span></div>
        </section>
      </div>
      <nav className="studio-mobile-switch" aria-label="Workspace panels">
        {([['tools', hardware ? 'HARDWARE' : 'BUILD KIT'], ['canvas', 'CANVAS'], ['inspector', 'SETTINGS']] as const).map(([id, label]) => <button key={id} className={mobileSection === id ? 'is-active' : ''} type="button" aria-pressed={mobileSection === id} onClick={() => setMobileSection(id)}>{label}</button>)}
      </nav>
      <div hidden={!hardware} style={!hardware ? {display: 'none'} : undefined}><HardwareSetup /></div>
      {!hardware && <BlockColorPicker />}
      <ExportDialog />
      <LoadDialog />
      <RecentModelsDialog />
      <ProjectActionDialog />
    </div>
  );
}
