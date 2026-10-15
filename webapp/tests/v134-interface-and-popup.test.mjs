import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = new URL('../src/', import.meta.url);
const engine = readFileSync(new URL('engine/builderEngine.ts', base), 'utf8');
const studio = readFileSync(new URL('studio.css', base), 'utf8');
const guide = readFileSync(new URL('components/TutorialContent.tsx', base), 'utf8');
const tutorial = readFileSync(new URL('tutorial.css', base), 'utf8');

test('eyedropper and current-color card share a stretched 34px height', () => {
  assert.match(studio, /block-color-popover__head-tools\{display:flex;align-items:stretch/);
  assert.match(studio, /block-color-popover \.block-color-current \{box-sizing:border-box;min-height:34px/);
  assert.match(studio, /block-color-popover \.block-color-eyedropper__trigger \{box-sizing:border-box;min-height:0/);
});

test('eyedropper instructions trigger a compact-height remeasurement', () => {
  assert.match(engine, /function measureCompactBlockColorPopover\(/);
  assert.match(engine, /if \(height > 0\) compactColorPopoverHeight = height/);
  assert.match(engine, /function updateColorTransferUi\([\s\S]*measureCompactBlockColorPopover\(\)/);
  assert.match(engine, /if \(next\) \{\s*\/\/ Includes any active eyedropper guidance[\s\S]*measureCompactBlockColorPopover\(\);/);
});

test('expanded custom-color popover reserves bottom clearance and scrolls when needed', () => {
  assert.match(engine, /const fullHeight = closedHeight \+ expandedAddition;/);
  assert.match(engine, /window.innerHeight - fullHeight - edge - 18/);
  assert.match(studio, /\.block-color-popover\.has-custom-color-open \{max-height:calc\(100dvh - 32px\);overflow-y:auto/);
});

test('guide maintains four recognizable numbered panels and one model illustration', () => {
  for (const name of ['BUILD KIT', 'LIVE DATA', 'LIVE FEEDBACK', 'CONTROL DECK', '3D WORKSPACE']) assert.ok(guide.includes(name));
  assert.match(guide, /mock-app--v135/);
  assert.match(guide, /mock-app__blocks/);
  assert.match(guide, /mock-panel--feedback/);
  assert.match(tutorial, /@media\(max-width:630px\)/);
});
