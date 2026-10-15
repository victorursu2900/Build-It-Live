import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const raw=fs.readFileSync(new URL('../src/engine/builderEngine.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('builderEngine.ts',raw,ts.ScriptTarget.Latest,true);
const functions=ast.statements.filter(ts.isFunctionDeclaration);
const names=['canonicalEdgeKey','snapDirectionToCadAngle','splitChainAtGridTurns','fitVectorLine','findVectorLineRuns','rasterMorph','closeRasterMask','chamferDistanceTo','blurScalarField2D','makeRasterLineDescriptor','localSmoothMax','localSmoothMin','createOversampledLayerSdfGeometry'];
const only=names.map(n=>functions.find(f=>f.name?.text===n)?.getText(ast)??(()=>{throw Error('Function missing: '+n)})());
// Extract the actual computational field just before triangulation. Avoids depending
// on a WebGL/browser installation while checking authored shape changes.
const geometryCode=only[only.length-1];
const hooked=geometryCode.replace('  const positions = [];', '  if (quality === "__test_field") return {field,bounds,step,nx,ny,nz,atExact:fieldAt,userData:{style:rounded?"rounded":"classic",capRadius,stepJoinRadius},at(x,y,z){const ix=Math.round((x-bounds.minX)/step),iy=Math.round((y-bounds.minY)/step),iz=Math.round((z-bounds.minZ)/step);return field[ix+nx*(iy+ny*iz)]}};\n  const positions = [];');
assert.notEqual(hooked,geometryCode);
const code=ts.transpileModule([...only.slice(0,-1),hooked].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
class Vec2{constructor(x=0,y=0){this.x=x;this.y=y}add(v){this.x+=v.x;this.y+=v.y;return this}multiplyScalar(n){this.x*=n;this.y*=n;return this}normalize(){const n=Math.hypot(this.x,this.y)||1;this.x/=n;this.y/=n;return this}clone(){return new Vec2(this.x,this.y)}dot(v){return this.x*v.x+this.y*v.y}}
const THREE={Vector2:Vec2,MathUtils:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),lerp:(a,b,t)=>a+(b-a)*t,degToRad:degrees=>degrees*Math.PI/180,radToDeg:radians=>radians*180/Math.PI}};
let blocks=[];const ctx=vm.createContext({THREE,model:{gridWidth:16,gridDepth:16,getBlocks:()=>blocks},console});vm.runInContext(code,ctx);
const b=(x,y,z,type='standard')=>({x,y,z,type,color:'#ff321c'});
const samples=(arr,style)=>{blocks=arr;return ctx.createOversampledLayerSdfGeometry(arr.filter(block=>block.type==='standard'),1,5,{quality:'__test_field',style})};
test('Classic keeps strict steps; Rounded softens the inner edge of a stair',()=>{
  const stair=[b(1,1,0),b(2,1,0),b(1,1,1)];
  const classic=samples(stair,'classic');const rounded=samples(stair,'rounded');
  assert.equal(classic.userData.style,'classic');assert.equal(classic.userData.capRadius,0);
  assert.ok(rounded.userData.capRadius>0);
  assert.ok(rounded.step<classic.step,'Rounded has finer sampling for curved transitions');
  let diff=0;for(let x=1;x<3;x+=.1)for(let y=1;y<2;y+=.1)for(let z=0;z<2;z+=.1)if(Math.abs(classic.at(x,y,z)-rounded.at(x,y,z))>1e-4)diff++;
  assert.ok(diff>100,'Rounded must change the real signed distance field, not only a UI label');
  // An inner step: upper layer ends at x=2, while the lower projects to x=3.
  const x=2.02,y=1.5,z=0.95;
  assert.ok(rounded.at(x,y,z)<classic.at(x,y,z),'Inner right-angle join must fill into a softer diagonal');
});
test('Rounded leaves intentionally empty support and disconnected opening regions unfilled',()=>{
  const wall=[];for(let z=0;z<3;z++)for(let x=0;x<3;x++)wall.push(b(x,1,z,x===1?'support':'standard'));
  const round=samples(wall,'rounded');
  assert.ok(round.at(1.5,1.5,1.5)>0,'Support opening must remain empty');
  assert.ok(round.at(.5,1.5,1.5)<0,'Left wall remains solid');
  assert.ok(round.at(2.5,1.5,1.5)<0,'Right wall remains solid');
});
test('Smoothing selector, worker payload and persisted project expose the same chosen style',()=>{
  const ui=fs.readFileSync(new URL('../src/components/BuildControls.tsx',import.meta.url),'utf8');
  const worker=fs.readFileSync(new URL('../build/smoothKernel.mjs',import.meta.url),'utf8');
  for(const button of ['classic','rounded'])assert.ok(ui.includes('data-smooth-edge-profile="'+button+'"'));
  assert.ok(raw.includes('smoothWorker.compute({blocks,gridWidth:model.gridWidth,gridDepth:model.gridDepth,strength,quality:\'export\',style:smoothEdgeProfile})'));
  assert.ok(raw.includes('smoothEdgeProfile: data?.render?.smoothEdgeProfile'));
  assert.ok(worker.includes('createOversampledLayerSdfGeometry(standards,1,strength,{quality,style})'));
});
test('architectural façade: rounded profile keeps slender towers, window void and recessed center',()=>{
  const facade=[];
  for(let z=0;z<9;z++)for(let x=3;x<=9;x++){
    const cut=(x===5||x===6)&&(z>=2&&z<=5);
    facade.push(b(x,4,z,cut?'support':'standard'));
  }
  for(let z=9;z<=12;z++)for(const x of [3,9])facade.push(b(x,4,z));
  for(let z=9;z<=11;z++)facade.push(b(6,4,z));
  const rounded=samples(facade,'rounded');
  for(const z of [9.5,10.5,11.5])for(const x of [3.5,6.5,9.5]){
    assert.ok(rounded.at(x,4.5,z)<0,`slender tower must remain solid at ${x},${z}`);
  }
  for(const z of [2.5,3.5,4.5,5.5])for(const x of [5.5,6.5]){
    assert.ok(rounded.at(x,4.5,z)>0,`authored opening must remain empty at ${x},${z}`);
  }
  assert.ok(rounded.at(4.5,4.5,4.5)<0,'adjacent narrow wall is preserved');
  assert.ok(rounded.at(7.5,4.5,4.5)<0,'wall on other side remains solid');
});

test('shared layer faces stay solid near exterior edges instead of opening cap seams',()=>{
 const rounded=samples([b(1,1,0),b(2,1,0),b(1,1,1)],'rounded');
 for(const [x,y] of [[1.225,1.1],[1.225,1.9],[1.25,1.1],[1.25,1.9],[1.3,1.075],[1.3,1.925],[1.325,1.075],[1.325,1.925],[1.65,1.05],[1.65,1.95]])assert.ok(rounded.atExact(x,y,1)<0,`Shared face is solid at ${x},${y},1`);
});
