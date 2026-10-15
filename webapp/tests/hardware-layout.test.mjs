import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('hardware controls keep every action binding and remove redundant headings', () => {
  const kit = read('../src/components/HardwareKit.tsx');
  for (const id of ['standardColorSwatch','saveBuild','exportBuild','resetView','clearBuild']) {
    assert.match(kit, new RegExp(`id="${id}"`));
  }
  // Engine-only load hooks exist but do not appear in the Project Files controls.
  const visibleFileActions = kit.match(/<div className="panel-actions panel-actions--files project-file-actions">([\s\S]*?)<\/div>/)?.[1] ?? '';
  assert.doesNotMatch(visibleFileActions, /LOAD PROJECT|id="loadBuild"|id="loadBuildInput"/);
  assert.match(kit, /<div hidden style=\{\{ display: 'none' \}\} aria-hidden="true" inert>/);
  assert.equal((kit.match(/>PROJECT FILES</g) ?? []).length, 1);
  assert.equal((kit.match(/>MODEL COLORS</g) ?? []).length, 0); // inline palette supplies the only heading
  assert.match(kit, /<BlockColorPicker embedded \/>/);
  assert.doesNotMatch(kit, /panel-rule|Physical form\.|Digital color\.|Loading and clearing are paused/);
});

test('hardware live data stays in Inspector with one physical grid', () => {
  const stats = read('../src/components/LiveStats.tsx');
  const app = read('../src/pages/BuilderApp.tsx');
  for (const id of ['gridMetric','physicalGridMetric','heightMetric','blockMetric','hardwareInputMetric']) {
    assert.match(stats, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(stats, /MODEL GRID|BOARD GRID|SENSOR STATUS/);
  assert.match(stats, /id="hardwareInputMetric" hidden aria-hidden="true"/);
  for (const label of ['<span>GRID</span>','MAX HEIGHT','BLOCKS']) {
    assert.ok(stats.includes(label));
  }
  assert.match(app, /hardware \? <HardwareKit \/> : <BuildKit \/>/);
  assert.match(app, /<LiveStats mode=\{mode\} \/>\{hardware && <HardwareWorkbenchTools placement="diagnostics" \/>\}<LiveFeedback mode=\{mode\} \/>/);
});

test('Hardware setup asks only for physical board size', () => {
  const setup = read('../src/components/HardwareSetup.tsx');
  const engine = read('../src/engine/builderEngine.ts');
  assert.match(setup, /id="hardwareBoardWidth"/);
  assert.doesNotMatch(setup, /id="hardwareDigitalGrid"|id="hardwareDigitalDepth"|id="hardwareUnevenGrid"/);
  assert.match(engine, /hardwareDigitalDimensions\(boardWidth, boardDepth\)/);
  assert.doesNotMatch(engine, /const hardwareDigitalGrid|const hardwareDigitalDepth|const hardwareUnevenGrid/);
  assert.match(setup, /ONE-TO-ONE MAPPING/);
});

test('digital builder and control functionality stay intact', () => {
  const controls = read('../src/components/BuildControls.tsx');
  const app = read('../src/pages/BuilderApp.tsx');
  for (const id of ['autosaveToggle','openRecentModels','layerSlider','showAllLayers','realtimeSmoothingSlider','continuousToggle']) {
    assert.match(controls, new RegExp(`id="${id}"`));
  }
  assert.match(controls, /hidden=\{mode === 'hardware'\}/);
  assert.match(app, /hardware \? <HardwareKit \/> : <BuildKit \/>/);
  assert.match(app, /hardware \? 'WORKBENCH' : 'BUILD KIT'/);
});

test('hardware-only CSS is isolated and includes responsive, overflow-safe rails', () => {
  const css = read('../src/hardware-builder.css');
  assert.match(css, /#app\.studio-app\.hardware-builder \.studio-sidebar \.studio-rail-scroll/);
  assert.match(css, /scrollbar-width: none/);
  assert.match(css, /overflow-y: auto/);
  assert.match(css, /max-height: 745px/);
  assert.match(css, /max-width: 860px/);
  assert.match(css, /#serialStatus\.is-connected/);
});


test('hardware palette is embedded once, while Digital Builder retains its original popup', () => {
  const kit = read('../src/components/HardwareKit.tsx');
  const app = read('../src/pages/BuilderApp.tsx');
  const component = read('../src/components/BlockColorPicker.tsx');
  const engine = read('../src/engine/builderEngine.ts');
  const css = read('../src/hardware-builder.css');
  assert.match(kit, /<BlockColorPicker embedded \/>/);
  assert.doesNotMatch(kit, /CHOOSE COLOR|hardware-color-trigger/);
  assert.match(app, /!hardware && <BlockColorPicker \/>/);
  assert.match(component, /hidden=\{!embedded\}/);
  assert.match(component, /hardware-color-inline is-open/);
  assert.match(engine, /if \(IS_HARDWARE_BUILDER\) return; \/\/ Integrated workbench palette/);
  assert.match(engine, /if \(IS_HARDWARE_BUILDER\) return; \/\/ Permanent hardware palette/);
  assert.match(css, /hardware-color-inline/);
  assert.match(css, /position: relative !important/);
  assert.match(css, /grid-template-columns: repeat\(5,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css, /hardware-color-trigger/);
});

test('hardware defaults to a 2×4 physical plate and keeps two independent size inputs', () => {
  const setup = read('../src/components/HardwareSetup.tsx');
  const engine = read('../src/engine/builderEngine.ts');
  const stats = read('../src/components/LiveStats.tsx');
  assert.match(setup, /id="hardwareBoardWidth"[^>]*value="2"/);
  assert.match(setup, /id="hardwareBoardDepth"[^>]*value="4"/);
  assert.match(engine, /boardWidth: 2, boardDepth: 4, digitalWidth: 2, digitalDepth: 4/);
  assert.match(engine, /sensorChannelToCell\(ch, boardWidth, model.gridWidth, model.gridDepth, boardDepth\)/);
  assert.match(stats, /id="physicalGridMetric">2×4/);
});

test('hardware stats use the exact shared Digital Builder card variants and shortcut sizing', () => {
  const stats = read('../src/components/LiveStats.tsx');
  const css = read('../src/hardware-builder.css');
  const app = read('../src/pages/BuilderApp.tsx');
  assert.match(stats, /className="stats-grid hardware-metrics"/);
  assert.match(stats, /stat-card stat-card--light/);
  assert.match(stats, /stat-card stat-card--dark/);
  assert.match(css, /studio-shortcuts \.helpbar \{[\s\S]*?width: 337px/);
  assert.match(app, /<b>ESP32<\/b> input/);
});


test('Hardware-only polish: remove redundant appearance number and bottom-align fitted palette labels', () => {
  const component = read('../src/components/BlockColorPicker.tsx');
  const css = read('../src/hardware-builder.css');
  assert.match(component, /!embedded && <span>BLOCK COLOR \/ 01<\/span>/);
  assert.doesNotMatch(component, /01 \/ APPEARANCE/);
  assert.match(component, /embedded \? "FINE TUNE" : "03 \/ FINE TUNE"/);
  assert.match(css, /hardware-color-inline \.block-color-choice--standard > span/);
  assert.match(css, /hardware-color-inline \.block-color-custom__label/);
  assert.match(css, /bottom: 5px;/);
  assert.match(css, /font-size: 7px !important;/);
  assert.match(css, /transform: translateX\(-50%\) !important;/);
});

test('Workbench content retains a bottom gutter when scrolled to Project Files', () => {
  const css = read('../src/hardware-builder.css');
  assert.match(css, /hardware-kit::after \{/);
  assert.match(css, /flex: 0 0 26px/);
});


test('Hardware Builder removes only NEW target and defaults to ENTIRE without affecting Digital Builder', () => {
  const component = read('../src/components/BlockColorPicker.tsx');
  const engine = read('../src/engine/builderEngine.ts');
  const css = read('../src/hardware-builder.css');
  assert.match(component, /!embedded && <button[^>]*data-color-target="new"/);
  assert.match(component, /data-color-target="selected"/);
  assert.match(component, /data-color-target="all" aria-pressed=\{embedded\}/);
  assert.match(engine, /const DEFAULT_RECOLOR_TARGET = IS_HARDWARE_BUILDER \? 'all' : 'new'/);
  assert.match(engine, /let recolorTarget = DEFAULT_RECOLOR_TARGET/);
  assert.match(engine, /const allowed = IS_HARDWARE_BUILDER \? \['selected', 'all'\] : \['new', 'selected', 'all'\]/);
  assert.match(engine, /recolorTarget = DEFAULT_RECOLOR_TARGET;/);
  assert.match(css, /hardware-color-inline \.block-color-target__buttons \{[\s\S]*?grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(engine, /if \(IS_HARDWARE_BUILDER\) \{ selectedBlockColor = normalized; updateBlockColorUi\(\); \}/);
});
