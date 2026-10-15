import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const get=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css=get('src/night-mode.css'),engine=get('src/engine/builderEngine.ts');
test('Rail wrappers are not fake cards while meaningful cards keep surfaces',()=>{
 assert.match(css,/\.buildkit-create,.buildkit-files/);
 assert.match(css,/background:transparent!important/);
 assert.match(css,/\.tool-button,\.stat-card:not\(\.stat-card--accent\),\.feedback-card:not\(\.is-invalid\)/);
 assert.match(css,/\.stat-card--accent\{background:#ed392b!important/);
});
test('Close, back, size and all shared hover actions use off-white highlight',()=>{
 for(const value of ['.model-size-toggle','.grid-settings-close','.modal-close','.studio-theme-toggle','button[aria-label*="close" i]'])assert.ok(css.includes(value));
 assert.match(css,/background:var\(--dark-control\)!important/);
 assert.match(css,/color:var\(--dark-control-ink\)!important/);
 assert.match(css,/#app.studio-app #exportBuild:hover/);
});
test('Rounded geometry does not globally blur or alter Classic XY shape',()=>{
 assert.doesNotMatch(engine,/roundSignedVolume/);
 assert.match(engine,/const blurPasses = 3/);
 assert.match(engine,/const filterWeight = THREE.MathUtils.lerp\(\.20, 1, strengthT\)/);
 assert.match(engine,/const capRadius = rounded/);
 assert.match(engine,/localSmoothMin\(previousDistance,slabDistance,joinRadius\)/);
});
