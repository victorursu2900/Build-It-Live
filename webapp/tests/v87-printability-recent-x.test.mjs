import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=(file)=>readFileSync(new URL(file, import.meta.url),'utf8');
const engine=read('../src/engine/builderEngine.ts');
const recent=read('../src/components/RecentModelsDialog.tsx');
const style=read('../src/preflight-v86.css');
test('preflight shows clear report, summary and actionable findings without changing analyzer',()=>{
  assert.match(engine,/class="printability-report__result" role="status"/);
  assert.match(engine,/class="printability-report__summary" role="group"/);
  assert.match(engine,/report\.issues\.map/);
  assert.match(engine,/data-preflight-action="refresh"/);
  assert.match(engine,/previousDetails \? previousDetails\.open/);
  assert.match(engine,/escapeHtml\(issue\.title\)/);
  assert.match(engine,/escapeHtml\(issue\.detail\)/);
  assert.match(style,/\.printability-report__findings/);
});
test('recent models modal and individual project delete use the same shared X strokes',()=>{
  assert.match(recent,/className="modal-close recent-modal__close"/);
  assert.match(engine,/class="recent-delete modal-close"/);
  assert.match(style,/\.recent-modal__header #closeRecentModal::before/);
  assert.match(style,/\.recent-item__actions button\.recent-delete::after/);
  assert.match(style,/width: 13px; height: 1\.8px/);
});
