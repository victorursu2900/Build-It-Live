import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('hardware-only entry does not display simulator controls', () => {
  const header=read('../src/components/BuilderHeader.tsx');
  const engine=read('../src/engine/builderEngine.ts');
  const modal=read('../src/components/HardwareSetup.tsx');
  assert.doesNotMatch(header, /id="simulateHardware"/);
  assert.match(engine, /if \(HARDWARE_ONLY_EDITION\) return;/);
  assert.match(engine, /if \(!HARDWARE_ONLY_EDITION &&/);
  assert.match(modal, /id="hardwareSimulationPanel" hidden style="display:none" inert/);
});

test('guide includes all six hardware chapters and supplied quantities', () => {
  const guide=read('../src/components/HardwareAssemblyGuide.tsx');
  const layout=read('../src/components/TutorialContent.tsx');
  for (const name of ['hwg-bom','hwg-print','hwg-assembly','hwg-wiring','hwg-firmware','hwg-connect'])
    assert.ok(guide.includes(`id="${name}"`));
  for (const text of ['80 ×','160 ×','400 ×','800 ×','10 kΩ','5.1 kΩ','400 kHz','860 SPS','layer 63','channel 0'])
    assert.ok(guide.toLowerCase().includes(text.toLowerCase()), `Missing supplied instruction: ${text}`);
  assert.match(layout, /<HardwareAssemblyGuide/);
});
