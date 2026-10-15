import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = filename => readFileSync(path.join(root, 'src', filename), 'utf8');

test('V67 does not lock scroll when panels need to expand', () => {
  const css = read('studio.css');
  const helper = read('ui/railBounce.ts');
  assert.match(css, /V67 \/ Side rails use native, content-driven scrolling/);
  assert.match(css, /overflow-y:\s*auto !important/);
  assert.doesNotMatch(css, /\.studio-rail-scroll\.is-rail-static/);
  assert.doesNotMatch(helper, /new ResizeObserver|classList\.toggle\(.is-rail-static.|\.style\.overflowY\s*=\s*.hidden./);
  assert.match(helper, /maxScroll <= OVERFLOW_TOLERANCE_PX/);
});

test('V67 keeps exactly one visible OFFLINE connection indicator on Hardware Builder', () => {
  const header = read('components/BuilderHeader.tsx');
  const stats = read('components/LiveStats.tsx');
  const diagnostics = read('components/HardwareWorkbenchTools.tsx');
  assert.match(header, /id="serialStatus"[^>]*>.*OFFLINE/);
  assert.match(stats, /id="hardwareInputMetric" hidden aria-hidden="true"/);
  assert.doesNotMatch(stats, /SENSOR STATUS/);
  assert.match(diagnostics, /title="02 \/ SENSOR DIAGNOSTICS" meta=\{monitor.connected \? 'LIVE' : ''\}/);
  assert.doesNotMatch(diagnostics, /monitor.connected \? 'LIVE' : 'OFFLINE'/);
});

test('Guide page links and internal anchors resolve', () => {
  const guides = ['components/TutorialContent.tsx', 'components/HardwareAssemblyGuide.tsx',
    'components/TutorialHeader.tsx', 'components/TutorialFooter.tsx',
    'components/InteractiveWalkthrough.tsx', 'pages/TutorialApp.tsx'];
  const source = guides.map(read).join('\n');
  const ids = new Set(Array.from(source.matchAll(/\bid="([\w-]+)"/g), match => match[1]));
  const links = Array.from(source.matchAll(/\bhref="([#.][^"\s]+)"/g), match => match[1]);
  assert.ok(links.length >= 14, 'guide should contain multiple cross-chapter and page links');
  for (const href of links) {
    if (href.startsWith('#')) assert.ok(ids.has(href.slice(1)), `missing Guide anchor ${href}`);
    else assert.ok(existsSync(path.join(root, href)), `missing Guide page ${href}`);
  }
  for (const page of ['./index.html', './digital.html', './brickmaker.html', './tutorial.html']) {
    assert.ok(links.includes(page), `missing link to ${page}`);
  }
});
