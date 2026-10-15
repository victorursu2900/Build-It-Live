// V140 replaces the V139 global signed-volume blur because it distorted slender details.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const engine=read('src/engine/builderEngine.ts'),css=read('src/night-mode.css'),kernel=read('build/smoothKernel.mjs');
function extract(name){const a=engine.indexOf('function '+name+'(');assert.ok(a>=0);const b=engine.indexOf('{',a);let depth=0,i=b;for(;i<engine.length;i++){if(engine[i]==='{')depth++;else if(engine[i]==='}'&&!--depth)break;}return engine.slice(a,i+1)}
const context=vm.createContext({Math});vm.runInContext(extract('localSmoothMax')+'\n'+extract('localSmoothMin'),context);
test('convex caps round inward but flat faces remain exactly where authored',()=>{
  const k=.3;
  assert.ok(context.localSmoothMax(0,0,k)>0,'convex junction is cut inward');
  for(const a of [-2,-1,-.5,0,.5,1])assert.equal(context.localSmoothMax(a,a+2,k),a+2,'planar face remains exact');
});
test('concave joins fill locally rather than blurring a whole model',()=>{
  assert.ok(context.localSmoothMin(0,0,.3)<0);
  assert.equal(context.localSmoothMin(-1,1,.3),-1);
});
test('Rounded is local, Classic is the same hard cap, worker bundles new helpers',()=>{
  assert.doesNotMatch(engine,/function roundSignedVolume\(/);
  assert.match(engine,/const slabDistance=rounded\?Math.max\(run.bottom===0\?-zWorld:-Infinity,localSmoothMax/);
  assert.match(engine,/previousRun.top===run.bottom/);
  assert.match(kernel,/'localSmoothMax','localSmoothMin','localChamferMin'/);
  assert.match(engine,/localSmoothMax\(d,-supportDistance,nearestSupportLipRadius\)/);
});
test('dark mode controls, color choices, assembly map and guide stay consistent',()=>{
  assert.match(read('src/components/ThemeToggle.tsx'),/'DARK MODE'/);
  for(const token of ['--dark-control','#app.studio-app .studio-sidebar','button[aria-label*="close" i]','backdrop-filter:blur(17px)','mock-app__stage-label','--dark-accent'])assert.ok(css.includes(token),token);
  assert.match(css,/\.block-color-custom[\s\S]*?conic-gradient/);
  assert.match(css,/\.studio-assembly-map \.assembly-grid-coordinate/);
  assert.match(read('src/studioTools.js'),/assembly-grid-coordinate/);
});
