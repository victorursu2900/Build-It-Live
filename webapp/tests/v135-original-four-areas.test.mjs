import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const guide = readFileSync(new URL('../src/components/TutorialContent.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/tutorial.css', import.meta.url), 'utf8');
const section = guide.slice(guide.indexOf('className="interface-map glass-card guide-interface-v135"'), guide.indexOf('<InteractiveWalkthrough'));
test('restores original floating 4-area visual instead of V132–134 mini-interface', () => {
  assert.equal((section.match(/className="mock-panel mock-panel--/g) ?? []).length, 4);
  assert.ok(section.includes('mock-grid'));
  assert.ok(section.includes('mock-app__blocks'));
  assert.doesNotMatch(section,/guide-interface__inspector|guide-interface__tool--active|guide-interface__layout/);
});
test('explicit purpose-led title and notes for all 4 areas', () => {
  for (const token of ['01','02','03','04','BUILD KIT','LIVE DATA','LIVE FEEDBACK','CONTROL DECK','3D WORKSPACE','ADD, COLOR','COUNT, SIZE','STATUS, ACTIONS','MODES, LAYERS']) assert.ok(section.includes(token), `missing ${token}`);
  assert.equal((section.match(/className="interface-notes__item"/g) ?? []).length,4);
});
test('new diagram has responsive rules and legible number badges', () => {
  assert.match(css,/guide-interface-v135 \.mock-panel__top span\{font-size:35px/);
  assert.match(css,/@media\(max-width:630px\)/);
  assert.match(css,/interface-notes__heading>span\{display:block;width:auto/);
});
