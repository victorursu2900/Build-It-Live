// Retained compatibility checks for V138's night-mode/layout fixes.
// Rounded's former contour-interpolation method was deliberately replaced in V139.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const read=f=>fs.readFileSync(new URL(f,root),'utf8');
const engine=read('src/engine/builderEngine.ts');
const night=read('src/night-mode.css');
const brick=read('src/brickmaker.css');
const kernel=read('build/smoothKernel.mjs');
test('V138 color, slider, loading and palette regressions are retained',()=>{
 assert.match(brick,/\.brick-cell\.is-on \{ background: var\(--accent\)/);
 assert.match(night,/#brickGrid \.brick-cell\.is-on/);
 assert.match(night,/\.smooth-loading-track,\.capture-progress-track,\.assembly-progress-track/);
 assert.match(night,/width: calc\(100% - 24px\)/);
});
test('V140 local step rounding supersedes V139 global blur in both preview and worker',()=>{
 assert.doesNotMatch(engine,/function roundedStepDistance\(/);
 assert.match(engine,/function localSmoothMax\(/);
 assert.match(kernel,/'localSmoothMax'/);
 assert.match(engine,/const rounded = style === 'rounded'/);
 assert.match(engine,/const surface=fieldAt/);
 assert.match(engine,/supportVoidAt\(x,y,zWorld\)/);
});
