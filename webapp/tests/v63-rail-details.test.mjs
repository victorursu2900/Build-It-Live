import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('hardware Workbench footer indicates physical sensor input; Digital Build Kit still editable', () => {
  const app = read('pages/BuilderApp.tsx');
  const css = read('hardware-builder.css');
  assert.match(app, /className="studio-rail-foot"><span className="studio-pulse" \/> \{hardware \? 'SENSOR MODE' : 'BUILD MODE'\}/);
  assert.match(app, /hardware \? '\/ PHYSICAL INPUT' : '\/ EDITABLE'/);
  assert.doesNotMatch(css, /hardware-builder \.studio-sidebar \.studio-rail-foot \{ display: none;/);
});

test('both Inspectors display shared auto-updated model status footer', () => {
  const app = read('pages/BuilderApp.tsx');
  assert.match(app, /<div className="studio-rail-foot">MODEL STATUS <span className="studio-foot-detail">\/ AUTO-UPDATED<\/span><\/div>/);
  assert.doesNotMatch(app, /!hardware && <div className="studio-rail-foot">MODEL STATUS/);
});

test('both Inspectors have a slightly shorter gap above Live Data, including short viewports', () => {
  const css = read('studio.css');
  const block = css.split('V63 / Small inspector alignment')[1];
  assert.ok(block, 'Missing V63 alignment rules');
  assert.match(block, /#app\.studio-app \.studio-sidebar--inspector \.studio-rail-scroll \{\s*padding-top: 8px;/);
  assert.match(block, /max-height: 740px[\s\S]*padding-top: 6px/);
});

test('only Digital Builder removes the Undo-Redo right divider', () => {
  const css = read('studio.css');
  const block = css.split('V63 / Small inspector alignment')[1];
  assert.match(block, /#app\.studio-app\.digital-builder \.studio-top-actions \.top-history \{[\s\S]*?border-right: 0;[\s\S]*?padding-right: 0;/);
  assert.doesNotMatch(block, /#app\.studio-app\.hardware-builder \.studio-top-actions \.top-history/);
});
