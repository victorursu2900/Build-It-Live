import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/hardware-builder.css', import.meta.url), 'utf8');
const tools = readFileSync(new URL('../src/components/HardwareWorkbenchTools.tsx', import.meta.url), 'utf8');

test('Hardware Builder keeps plain animated SVG chevrons without a boxed background', () => {
  const chevronRule = css.match(/\/\* Bare chevron[^]*?(?=\n#app\.studio-app\.hardware-builder \.hardware-tool-summary:hover \.hardware-tool-summary__label)/)?.[0] ?? '';
  assert.match(chevronRule, /width:\s*18px/);
  assert.match(chevronRule, /\.is-open \.hardware-tool-chevron\s*\{\s*transform: rotate\(180deg\)/);
  assert.doesNotMatch(chevronRule, /border:\s*1px|background:\s*#/);
  assert.match(tools, /aria-expanded=\{open\}/);
  assert.match(tools, /hardware-tool-chevron/);
});

test('Hardware connection has the same outer height as Undo on desktop', () => {
  assert.match(css, /\.studio-top-actions \.top-serial\s*\{[^}]*height:\s*35px;[^}]*min-height:\s*35px;[^}]*max-height:\s*35px/s);
  assert.match(css, /\.glass-select--baud \.glass-select__trigger\s*\{[^}]*height:\s*29px;/s);
  assert.match(css, /#connectSerial, #disconnectSerial, #hardwareMenuButton, #simulateHardware[\s\S]*?height:\s*29px/);
});

test('Tablet height and all adjustments remain scoped to Hardware Builder', () => {
  assert.match(css, /@media \(max-width: 860px\)\s*\{\s*#app\.studio-app\.hardware-builder \.studio-top-actions \.top-serial\s*\{\s*height: 34px;/);
  assert.match(css, /#app\.studio-app\.hardware-builder \.studio-top-actions \.top-serial/);
});
