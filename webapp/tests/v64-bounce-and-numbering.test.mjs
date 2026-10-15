import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('Digital Inspector sections number 01 Live Data, 02 Live Feedback, 03 Control Deck', () => {
  assert.match(read('components/LiveStats.tsx'), /'01 \/ LIVE DATA'/);
  assert.match(read('components/LiveFeedback.tsx'), /mode === 'hardware' \? '03 \/ LIVE FEEDBACK' : '02 \/ LIVE FEEDBACK'/);
  assert.match(read('components/BuildControls.tsx'), /mode === 'hardware' \? '04 \/ CONTROL DECK' : '03 \/ CONTROL DECK'/);
});

test('Hardware Inspector stays numbered with Diagnostics between Live Data and Feedback', () => {
  const app = read('pages/BuilderApp.tsx');
  assert.match(app, /<LiveStats mode=\{mode\} \/>\{hardware && <HardwareWorkbenchTools placement="diagnostics" \/>\}<LiveFeedback mode=\{mode\} \/><BuildControls mode=\{mode\} \/>/);
});

test('only Hardware Inspector slightly reduces top padding and keeps short-screen adjustment', () => {
  const css = read('hardware-builder.css').split('V64 / Slightly tighter Hardware Inspector')[1];
  assert.ok(css);
  assert.match(css, /padding-top: 6px/);
  assert.match(css, /max-height: 740px[\s\S]*padding-top: 4px/);
});

test('only two Builder sidebar scroll regions get passive boundary rebound, with cleanup and motion preference', () => {
  const app = read('pages/BuilderApp.tsx');
  const helper = read('ui/railBounce.ts');
  assert.match(app, /const cleanupBounce = installRailBounce\(root\)/);
  assert.match(helper, /\.studio-sidebar--tools > \.studio-rail-scroll, \.studio-sidebar--inspector > \.studio-rail-scroll/);
  assert.match(helper, /if \(maxScroll <= OVERFLOW_TOLERANCE_PX\) return/);
  assert.match(helper, /atTop = rail.scrollTop <= 1 && event.deltaY < 0/);
  assert.match(helper, /atBottom = rail.scrollTop >= maxScroll - 1 && event.deltaY > 0/);
  assert.match(helper, /prefers-reduced-motion: reduce/);
  assert.match(helper, /passive: true/);
  assert.match(helper, /removeEventListener\('wheel', onWheel\)/);
});
