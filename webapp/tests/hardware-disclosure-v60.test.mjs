import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('calibration, diagnostics and recent captures share accessible animated disclosure controls', () => {
  const tools = read('../src/components/HardwareWorkbenchTools.tsx');
  for (const label of ['SENSOR DIAGNOSTICS', 'SENSOR CALIBRATION', 'RECENT CAPTURES'])
    assert.ok(tools.includes(label), `Missing ${label}`);
  assert.match(tools, /useState\(defaultOpen\)/);
  assert.match(tools, /aria-expanded=\{open\}/);
  assert.match(tools, /aria-controls=\{panelId\}/);
  assert.match(tools, /aria-hidden=\{!open\} inert=\{!open\}/);
  assert.match(tools, /useId\(\)/);
  assert.match(tools, /<path d="m4 6 4 4 4-4" \/>/);
  assert.doesNotMatch(tools, /<details|<summary|⌄/);
});

test('opening and closing both animate; chevron rotates and reduced motion is respected', () => {
  const css = read('../src/hardware-builder.css');
  assert.match(css, /\.hardware-tool-reveal \{/);
  assert.match(css, /grid-template-rows: 0fr/);
  assert.match(css, /\.hardware-disclosure\.is-open \.hardware-tool-reveal \{/);
  assert.match(css, /grid-template-rows: 1fr/);
  assert.match(css, /transform: rotate\(180deg\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /transition: none !important/);
});

test('color palette label uses calibration heading font only inside Hardware Builder', () => {
  const css = read('../src/hardware-builder.css');
  assert.match(css, /#app\.studio-app\.hardware-builder \.hardware-color-inline \.color-palette-caption > span:first-child \{/);
  assert.match(css, /font: 900 10px\/1\.2 var\(--studio-control-font, Arial, sans-serif\)/);
  assert.match(css, /letter-spacing: \.035em/);
});
