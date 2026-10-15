import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const engine=read('../src/engine/builderEngine.ts');
const style=read('../src/preflight-v86.css');
const actions=read('../src/components/ProjectActionDialog.tsx');
const hardware=read('../src/hardware.tsx');
const digital=read('../src/digital.tsx');
test('printability report retains original analyzer and recheck action',()=>{
  assert.match(engine,/analyzeTriangleGeometry\(exactImportedStl\.rawGeometry/);
  assert.match(engine,/analyzeBlockPrintability\(model\.getBlocks\(\), exportSurfaceMode\)/);
  assert.match(engine,/data-preflight-action="refresh"/);
  assert.match(engine,/<details class="printability-report__details"/);
  assert.match(engine,/previousDetails \? previousDetails\.open/);
});
test('printability results use status, source, counters and accessible inspection details',()=>{
  assert.match(engine,/class="printability-report__result" role="status"/);
  assert.match(engine,/role="group" aria-label="Model statistics"/);
  assert.match(engine,/class="printability-report__severity"/);
  assert.match(engine,/escapeHtml\(issue\.detail\)/);
  assert.match(style,/\.printability-report__issue-top/);
  assert.match(style,/@media \(max-width: 600px\)/);
  assert.match(style,/prefers-reduced-motion: reduce/);
});
test('project action close button reuses the shared X control',()=>{
  assert.match(actions,/className="modal-close project-action-dialog__close"/);
  assert.match(actions,/aria-label="Cancel and close dialog"/);
  assert.doesNotMatch(read('../src/library-ux-v85.css'),/\.project-action-dialog__close \{ width:32px/);
});
test('updated panel stylesheet loads in both builders only',()=>{
  for (const entry of [digital,hardware]) assert.match(entry,/import '\.\/preflight-v86\.css';/);
  assert.doesNotMatch(read('../src/brickmaker.tsx'),/preflight-v86/);
});
