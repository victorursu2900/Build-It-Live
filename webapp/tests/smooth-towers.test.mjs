import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import {toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
test('two towers keep enclosed Support cavities, thin walls and the gap between towers at low/mid/high strength',()=>{
 const file=fs.readFileSync(new URL('../src/engine/builderEngine.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('engine.ts',file,ts.ScriptTarget.Latest,true),functions=ast.statements.filter(ts.isFunctionDeclaration).map(n=>n.getText(ast)).join('\n');
 const blocks=[];for(const origin of [0,6])for(let z=0;z<4;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++)blocks.push({x:x+origin,y,z,type:x===1&&y===1&&z<3?'support':'standard'});
 const context=vm.createContext({THREE,toCreasedNormals,model:{gridWidth:16,gridDepth:16,getBlocks:()=>blocks},console});vm.runInContext(ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 for(const strength of [1,3,5]){
  const geometry=context.createOversampledLayerSdfGeometry(blocks.filter(b=>b.type==='standard'),1,strength,{quality:'export'}),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld(true);
  const hit=(x,y,z,dx,dy,dz,near=0,far=Infinity)=>new THREE.Raycaster(new THREE.Vector3(x,y,z),new THREE.Vector3(dx,dy,dz),near,far).intersectObject(mesh);
  for(const origin of [0,6])for(const z of [.5,1.5,2.5])assert.equal(new Set(hit(origin+1.537,1.513,z+.037,1,0,0).map(h=>Math.round(h.distance*1e5))).size%2,0,'Support cavity absorbed');
  assert.equal(hit(4.5,1.5,-10,0,0,1).length,0,'Separate towers joined');
  for(const origin of [0,6])for(let z=0;z<3;z++)assert.equal(hit(origin+.5,.5,z+.5,0,0,1,.001,.999).length,0,'Thin wall has a seam');
  const edges=new Map(),p=geometry.getAttribute('position');for(let i=0;i<p.count;i+=3){const keys=[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)].map(v=>Math.round(v*1e5)).join(','));if(new Set(keys).size<3)continue;for(let j=0;j<3;j++){const k=[keys[j],keys[(j+1)%3]].sort().join('|');edges.set(k,(edges.get(k)||0)+1);}}
  assert.equal([...edges.values()].filter(n=>n!==2).length,0,'Open or nonmanifold edge');geometry.dispose();material.dispose();console.log('Tower cavities and closed thin walls passed at strength',strength);
 }
});
