import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url),'utf8');
const engine = read('../src/engine/builderEngine.ts');
const dialog = read('../src/components/ProjectActionDialog.tsx');
const css = read('../src/library-ux-v85.css');
const shell = read('../src/pages/BuilderApp.tsx');

test('project actions use one accessible modal, never native confirm or prompt', () => {
  assert.doesNotMatch(engine, /window\.(?:confirm|prompt)\(/);
  assert.match(dialog, /<dialog id="projectActionDialog"/);
  assert.match(dialog, /aria-labelledby="projectActionTitle"/);
  assert.match(engine, /dialog\.addEventListener\('cancel', onEscape\)/);
  assert.match(engine, /const cancel = \(\) => finish\(inputLabel \? null : false\)/);
  assert.match(engine, /requestProjectAction\(\{title:'DELETE THIS PROJECT\?'/);
  assert.match(engine, /requestProjectAction\(\{title:'DELETE THIS VERSION\?'/);
  assert.match(engine, /requestProjectAction\(\{title:'CLEAR ALL RECENTS\?'/);
  assert.match(shell, /<ProjectActionDialog \/>/);
});

test('version gallery can expand and collapse without rebuilding the list', () => {
  assert.match(engine, /class="recent-versions\$\{expanded \? ' is-open' : ''\}"/);
  assert.match(engine, /aria-expanded="\$\{expanded\}"/);
  assert.match(engine, /panel\.inert = !open/);
  assert.match(css, /grid-template-rows:0fr/);
  assert.match(css, /\.recent-versions\.is-open \{ grid-template-rows:1fr/);
});

test('printability has refresh and expandable findings', () => {
  assert.match(engine, /data-preflight-action="refresh"/);
  assert.match(engine, /<details class="printability-report__details"/);
  assert.match(css, /\.printability-report__summary/);
});

test('library UX honors reduced motion and mobile widths', () => {
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /@media \(max-width:600px\)/);
});
