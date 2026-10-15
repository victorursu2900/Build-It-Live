import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const colorComponent = readFileSync(new URL('../src/components/BlockColorPicker.tsx', import.meta.url), 'utf8');
const colorCss = readFileSync(new URL('../src/studio.css', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../src/components/TutorialContent.tsx', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');

test('color eyedropper is a compact header control and retains sampling IDs', () => {
  assert.match(colorComponent, /block-color-popover__head-tools/);
  assert.match(colorComponent, /id="colorEyedropperToggle"/);
  assert.match(colorComponent, /id="colorEyedropperSwatch"/);
  assert.match(colorComponent, /id="colorEyedropperHint"/);
  assert.doesNotMatch(colorComponent, /id="blockColorEyedropper"/);
  assert.doesNotMatch(colorComponent, /id="colorEyedropperStop"/);
  assert.match(colorCss, /width:32px;height:auto/);
  assert.match(engine, /trigger\.setAttribute\('aria-label'/);
  assert.match(engine, /colorTransferMode==='paint'/);
});

test('guide includes only four named panels arranged around model workspace', () => {
  const visual = guide.slice(guide.indexOf('className="interface-map glass-card guide-interface-v135"'), guide.indexOf('<InteractiveWalkthrough'));
  assert.match(visual, /BUILD KIT/);
  assert.match(visual, /LIVE DATA/);
  assert.match(visual, /LIVE FEEDBACK/);
  assert.match(visual, /CONTROL DECK/);
  assert.match(visual, /3D WORKSPACE/);
  assert.doesNotMatch(visual, /guide-interface__legend|guide-interface__file-actions|guide-interface__control-line/);
});
