import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('Bill of Materials opens seven direct Amazon product IDs, never Google searches', () => {
  const source = read('components/HardwareAssemblyGuide.tsx');
  const ids = ['B0CMD8ZQ5H','B0D91XW41N','B00JR5R6OM','B0DLWXWG8S',
    'B0GDXYKWMH','B0CL6NGWQY','B0G8CNMM3L'];
  assert.doesNotMatch(source, /google\.com\/search/);
  for (const id of ids) assert.ok(source.includes(`https://www.amazon.de/dp/${id}`), id);
  assert.equal([...source.matchAll(/https:\/\/www\.amazon\.de\/dp\/[A-Z0-9]{10}/g)].length, 7);
});

test('sidebars use a computed fit state without permanently locking native scroll', () => {
  const code = read('ui/railOverflow.ts');
  const css = read('studio.css');
  const app = read('pages/BuilderApp.tsx');
  assert.match(code, /rail\.scrollHeight > rail\.clientHeight \+ SCROLL_EPSILON_PX/);
  assert.match(code, /classList\.toggle\('is-rail-fit', !needed\)/);
  assert.match(code, /new ResizeObserver\(schedule\)/);
  assert.match(code, /mutation\.observe\(rail/);
  assert.match(code, /resize\?\.observe\(element\)/);
  assert.match(code, /resize\?\.disconnect\(\)/);
  assert.match(app, /installRailOverflow\(root\)/);
  assert.match(css, /\.studio-rail-scroll\.is-rail-fit/);
  assert.match(css, /overflow-y: clip !important/);
  assert.match(css, /overflow-y: auto !important/);
});
