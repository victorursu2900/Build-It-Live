import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load=(name)=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');

test('every standalone app page applies the saved theme before mounting React',()=>{
  for(const page of ['index.html','hardware.html','digital.html','brickmaker.html','tutorial.html']){
    const html=load(page);
    assert.match(html, /build-it-live:color-theme/);
    assert.match(html, /data(?:set)?\.theme/);
    assert.ok(html.indexOf('dataset.theme')<html.indexOf('id="root"'), `${page} should initialize before rendering`);
  }
});
test('all four headers expose the same day/night switch',()=>{
  for(const header of ['BuilderHeader','BrickMakerHeader','TutorialHeader']) assert.match(load(`src/components/${header}.tsx`), /<ThemeToggle\s*\/>/);
  const toggle=load('src/components/ThemeToggle.tsx');
  assert.match(toggle, /localStorage\.setItem/);
  assert.match(toggle, /aria-pressed/);
  assert.match(toggle, /bil:theme-change/);
  assert.match(toggle, /addEventListener\('storage'/);
});
test('night palette is installed last in every page and preserves semantic status',()=>{
  for(const entry of ['digital.tsx','hardware.tsx','brickmaker.tsx','tutorial.tsx']) assert.match(load(`src/${entry}`), /import '\.\/night-mode\.css';/);
  const css=load('src/night-mode.css');
  assert.match(css, /\-\-paper:\s*#151619/);
  assert.match(css, /\.stat-card--accent/);
  assert.match(css, /\.mock-panel--feedback/);
  assert.match(css, /max-width:\s*860px/);
  const generated=load('src/night-neutral-generated.css');
  assert.match(generated, /html\[data-theme="dark"\]/);
  assert.match(generated, /light-dark\(/);
});
test('3D builders and interactive guide update their display palettes without altering block colors',()=>{
  for(const engine of ['builderEngine','brickMakerEngine']){
    const source=load(`src/engine/${engine}.ts`);
    assert.match(source,/bil:theme-change/);
    assert.match(source,/document\.documentElement\.dataset\.theme/);
  }
  assert.match(load('src/components/GuideModelViewport.tsx'),/bil:theme-change/);
  assert.match(load('src/engine/builderEngine.ts'),/scene\.background\.setHex/);
  assert.match(load('src/engine/brickMakerEngine.ts'),/previewScene\.background\.setHex/);
});
