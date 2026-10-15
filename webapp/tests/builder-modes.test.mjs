import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('both builders have separate entry points and links', () => {
  assert.match(read('vite.config.ts'), /hardware: resolve\(.+hardware\.html/);
  assert.match(read('src/components/BuilderHeader.tsx'), /DIGITAL BUILDER/);
  assert.match(read('src/components/BuilderHeader.tsx'), /HARDWARE BUILDER/);
  assert.match(read('src/hardware.tsx'), /mode="hardware"/);
  assert.match(read('src/index.tsx'), /import '\.\/hardware'/);
  assert.match(read('src/digital.tsx'), /mode="digital"/);
});
test('sensor and placement tools are separated', () => {
  const code = read('src/engine/builderEngine.ts');
  assert.match(code, /if \(!IS_HARDWARE_BUILDER\) return;/);
  assert.match(code, /PHYSICAL INPUT ONLY/);
  assert.match(code, /IS_HARDWARE_BUILDER\s*\? normalized\.map/);
  assert.match(read('src/pages/BuilderApp.tsx'), /hardware \? <HardwareKit \/> : <BuildKit \/>/);
  assert.doesNotMatch(read('src/components/HardwareKit.tsx'), /data-tool="eraser"|data-tool="support"/);
  assert.match(read('src/components/BuildControls.tsx'), /hidden=\{mode === 'hardware'\}/);
});
test('physical color control and model storage survive sensor operation', () => {
  const code = read('src/engine/builderEngine.ts');
  assert.match(code, /HARDWARE_CONFIG\.standardColor = normalized/);
  assert.match(code, /previousColors\.get/);
  assert.match(code, /digital-twin\.\$\{BUILDER_MODE\}\.autosave/);
  assert.match(code, /digital-twin\.autosave\.v1/); // legacy digital migration
});
