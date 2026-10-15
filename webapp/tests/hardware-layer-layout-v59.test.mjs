import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path,import.meta.url),'utf8');

test('ESP32 lock no longer disables Hardware Layer View, but digital locks remain', () => {
  const code=read('../src/engine/builderEngine.ts');
  const locks=code.slice(code.indexOf('function updateOrganicEditingLocks('),code.indexOf('function setExportSurfaceMode('));
  assert.match(locks,/layerSlider\.disabled = organicLocked \|\| meshLocked \|\| \(sensorLocked && !IS_HARDWARE_BUILDER\)/);
  assert.match(locks,/showAllLayersButton\.disabled = organicLocked \|\| meshLocked \|\| \(sensorLocked && !IS_HARDWARE_BUILDER\)/);
  assert.match(locks,/clearBuildButton\.disabled = layerLocked \|\| sensorLocked/);
  const apply=code.slice(code.indexOf('function applyHardwareFrame('),code.indexOf('function applyHardwareEvent('));
  assert.match(apply,/syncViewFromModel\(\)/);
  assert.doesNotMatch(apply,/setLayerView\(0\)/);
  const smooth=code.slice(code.indexOf('function setExportSurfaceMode('),code.indexOf('function openSaveModal('));
  assert.match(smooth,/if \(activeLayerView !== null\) setLayerView\(0\)/);
});

test('Hardware Workbench holds calibration and Capture Model; Inspector holds diagnostics in correct reading order', () => {
  const kit=read('../src/components/HardwareKit.tsx');
  const app=read('../src/pages/BuilderApp.tsx');
  const tools=read('../src/components/HardwareWorkbenchTools.tsx');
  assert.ok(kit.indexOf('placement="calibration"') < kit.indexOf('PROJECT FILES'));
  assert.ok(kit.indexOf('PROJECT FILES') < kit.indexOf('placement="capture"'));
  const inspector=app.slice(app.indexOf('<div className="studio-rail-scroll"><LiveStats'), app.indexOf('</section>', app.indexOf('<div className="studio-rail-scroll"><LiveStats')));
  assert.ok(inspector.indexOf('LiveStats') < inspector.indexOf('placement="diagnostics"'));
  assert.ok(inspector.indexOf('placement="diagnostics"') < inspector.indexOf('LiveFeedback'));
  assert.ok(inspector.indexOf('LiveFeedback') < inspector.indexOf('BuildControls'));
  assert.match(tools,/if \(placement === 'diagnostics'\) return <HardwareDisclosure/);
  assert.match(tools,/if \(placement === 'calibration'\) return <HardwareDisclosure/);
  assert.match(tools,/EXPORT EVENT LOG \/ CSV/);
});
