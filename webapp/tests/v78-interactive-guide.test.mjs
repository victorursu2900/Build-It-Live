import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = relative => readFileSync(new URL(relative,import.meta.url), 'utf8');
const experiments = read('../src/components/GuideExperiments.tsx');
const guide = read('../src/components/TutorialContent.tsx');
const hardware = read('../src/components/HardwareAssemblyGuide.tsx');
const walkthrough = read('../src/components/InteractiveWalkthrough.tsx');
const app = read('../src/pages/TutorialApp.tsx');
const css = read('../src/guide-interactive.css');

test('new interactive labs keep hardware, brick, digital in the original chapter order', () => {
  const offsets = ['<HardwareAssemblyGuide />','<PhysicalDigitalDemo />','id="brick-maker-guide"','<BrickFootprintDemo />','id="digital-builder-guide"','<InteractiveWalkthrough />'].map(q=>guide.indexOf(q));
  assert.ok(offsets.every(i=>i!==-1));
  assert.deepEqual(offsets,offsets.toSorted((a,b)=>a-b));
});

test('physical-to-digital experiment uses an isolated 2 by 4 grid with no serial connection', () => {
  assert.match(experiments,/function PhysicalDigitalDemo/);
  assert.match(experiments,/length:8/);
  assert.match(css,/guide-sensor-grid,.guide-twin-grid \{display:grid;grid-template-columns:repeat\(2/);
  assert.match(experiments,/EXAMPLE FRAME/);
  assert.match(experiments,/No live ESP32 or sensor data/);
  assert.doesNotMatch(experiments,/navigator\.serial|requestPort|localStorage/);
});

test('assembly stepper highlights original magnet screw resistor groups without changing instructions', () => {
  for(const c of ['hwg-part--magnets','hwg-part--screws','hwg-part--resistor']) assert.ok(hardware.includes(c));
  assert.match(hardware,/setAssemblyStage\(i\)/);
  assert.match(hardware,/aria-pressed=\{assemblyStage === i\}/);
  assert.match(hardware,/4 × neodymium magnets/);
  assert.match(hardware,/2 × slotted brass screws/);
  assert.match(hardware,/1 × identification resistor/);
});

test('brick footprint demo stays interactive while digital walkthrough remains instructional', () => {
  assert.match(experiments,/function BrickFootprintDemo/);
  assert.match(experiments,/aria-pressed=\{cells\.includes\(i\)\}/);
  assert.match(experiments,/Actual source mesh, including screw channels and underside cavities/);
  assert.doesNotMatch(experiments, /DigitalBuildDemo|guide-build-mini/);
  assert.doesNotMatch(walkthrough, /DigitalBuildDemo/);
  assert.doesNotMatch(css, /guide-build-mini/);
  assert.match(walkthrough, /step-content/);
});

test('progress and one-time motion preserve reduced motion and keyboard access', () => {
  assert.match(app,/guide-reading-progress/);
  assert.match(app,/IntersectionObserver/);
  assert.match(app,/observer\.unobserve/);
  assert.match(app,/prefers-reduced-motion: reduce/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /:focus-visible/);
});
