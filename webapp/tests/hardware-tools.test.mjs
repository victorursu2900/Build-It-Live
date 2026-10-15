import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('hardware tools are distributed between Workbench and Inspector', () => {
  const kit = read('../src/components/HardwareKit.tsx');
  const tools = read('../src/components/HardwareWorkbenchTools.tsx');
  const app = read('../src/pages/BuilderApp.tsx');
  assert.match(kit, /<HardwareWorkbenchTools placement="calibration" \/>/);
  assert.match(kit, /<HardwareWorkbenchTools placement="capture" \/>/);
  assert.match(app, /hardware \? <HardwareKit \/> : <BuildKit \/>/);
  for (const label of ['SENSOR DIAGNOSTICS','SENSOR CALIBRATION','CAPTURE MODEL','SENSOR MAP','RECENT CAPTURES','RESISTANCE PROFILE']) {
    assert.ok(tools.includes(label), `Missing: ${label}`);
  }
  assert.match(app, /hardware && <HardwareWorkbenchTools placement="diagnostics" \/>/);
});

test('serial monitor forwards actual firmware readings, including unmatched values', () => {
  const engine = read('../src/engine/builderEngine.ts');
  assert.match(engine, /const rejected = applyHardwareEvent\(payload\);\s*recordHardwareReading\(payload, rejected\);/);
  assert.match(engine, /1000 \/ conductance/);
  assert.match(engine, /hardwareChannelEvents\.set\(channel, reading\)/);
  assert.match(engine, /new CustomEvent\('buildit:hardware-state'/);
  assert.match(engine, /readings: \[\.\.\.hardwareChannelEvents.values\(\)\]/);
});

test('calibration is optional, takes discrete ADD readings and never resets hardware grid', () => {
  const engine = read('../src/engine/builderEngine.ts');
  const tools = read('../src/components/HardwareWorkbenchTools.tsx');
  assert.match(tools, /latest\?\.action === 'add'/);
  assert.match(tools, /latestAdd\.sequence === lastSampledSequence/);
  assert.match(tools, /median\(samples\)/);
  assert.match(engine, /HARDWARE_CONFIG = structuredClone\(candidate\);\s*rebuildHardwareProfiles\(\)/);
  assert.match(engine, /Math\.abs\(others\[i\] - others\[j\]\) \/ Math\.min\(others\[i\], others\[j\]\) < 0\.12/);
});

test('PNG capture reads current scene and stores at most three snapshots', () => {
  const engine = read('../src/engine/builderEngine.ts');
  const tools = read('../src/components/HardwareWorkbenchTools.tsx');
  assert.match(engine, /renderer\.render\(scene, camera\);\s*return renderer\.domElement\.toDataURL\('image\/png'\);/);
  assert.match(tools, /\.slice\(0, 3\)/);
  assert.match(tools, /anchor\.download = `build-it-live-capture-/);
});

test('hardware tools CSS is scoped and tools do not require changing firmware', () => {
  const css = read('../src/hardware-builder.css');
  assert.match(css, /#app\.studio-app\.hardware-builder \.hardware-workbench-tools/);
  assert.match(css, /hardware-tool-summary/);
  assert.match(css, /hardware-sensor-map/);
  assert.match(css, /hardware-snapshots/);
});


test('diagnostic event log downloads recorded, bounded actual sensor readings', () => {
  const engine = read('../src/engine/builderEngine.ts');
  const tools = read('../src/components/HardwareWorkbenchTools.tsx');
  assert.match(engine, /hardwareEventLog\.push\(reading\)/);
  assert.match(engine, /hardwareEventLog\.length > 100/);
  assert.match(tools, /EXPORT EVENT LOG \/ CSV/);
  assert.match(tools, /type: 'text\/csv;charset=utf-8'/);
  assert.match(tools, /setSamples\(\[\]\); setLastSampledSequence\(-1\)/);
});
