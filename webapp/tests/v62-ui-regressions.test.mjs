import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('Control Deck top/bottom heading breathing room applies to both builders', () => {
  const css = read('studio.css');
  assert.match(css, /#app\.studio-app \.studio-sidebar--inspector \.feature-panel > \.panel-label\s*\{[^}]*padding:\s*clamp\(/);
  const deckRule = css.match(/#app\.studio-app \.studio-sidebar--inspector \.feature-panel > \.panel-label\s*\{[^}]+\}/)?.[0] ?? '';
  assert.doesNotMatch(deckRule, /hardware-builder|digital-builder/);
});

test('Brick Maker object preview does not shadow itself, physical STL export is preserved', () => {
  const code = read('engine/brickMakerEngine.ts');
  assert.match(code, /previewRenderer\.shadowMap\.enabled\s*=\s*false/);
  assert.match(code, /previewExactBrick\.receiveShadow\s*=\s*false/);
  assert.match(code, /previewUnifiedBrick\.receiveShadow\s*=\s*false/);
  assert.match(code, /new STLExporter\(\)\.parse\(group\)/);
  assert.match(code, /mergeScrewSurfaces/);
});

test('Cross-page transitions on all four main entrypoints', () => {
  for (const entry of ['hardware.tsx', 'digital.tsx', 'brickmaker.tsx', 'tutorial.tsx']) {
    assert.match(read(entry), /installPageTransitions\(\)/, entry);
    assert.match(read(entry), /page-transitions\.css/, entry);
  }
  const transitions = read('pageTransitions.ts');
  assert.match(transitions, /prefers-reduced-motion/);
  assert.match(transitions, /studio-primary-nav a, a\.studio-home/);
  assert.match(transitions, /event\.defaultPrevented/);
  assert.match(transitions, /next\.origin !== window\.location\.origin/);
  assert.match(transitions, /next\.hash/);
  assert.match(transitions, /window\.location\.assign/);
  assert.match(read('page-transitions.css'), /bil-page-enter/);
  assert.match(read('page-transitions.css'), /bil-page-exit/);
});
