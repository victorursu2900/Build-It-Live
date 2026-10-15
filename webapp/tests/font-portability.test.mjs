import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(resolve(base, name), 'utf8');

test('every page loads full-weight Inter for both macOS and Windows', () => {
  for (const page of ['index.html', 'hardware.html', 'digital.html', 'brickmaker.html', 'tutorial.html']) {
    const html = read(page);
    assert.match(html, /fonts\.googleapis\.com\/css2\?family=Inter:wght@400;500;600;700;800;900/);
    assert.match(html, /fonts\.gstatic\.com/);
  }
});
test('heavy display titles use the same cross-platform font fallback', () => {
  const baseStyles = read('src/style.css');
  const studio = read('src/studio.css');
  const guide = read('src/tutorial.css');
  assert.match(baseStyles, /--studio-display-font:[^;]*system-ui/);
  assert.match(baseStyles, /font-synthesis: weight/);
  assert.match(guide, /--tutorial-display: var\(--studio-display-font\)/);
  assert.match(studio, /studio-wordmark strong \{ font-family: var\(--studio-display-font\)/);
});
