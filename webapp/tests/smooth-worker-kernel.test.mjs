import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import {generateSmoothKernel} from '../build/smoothKernel.mjs';
test('worker kernel preserves the engine positions, normals, colors and palette exactly',()=>{
 const source=fs.readFileSync(new URL('../src/engine/builderEngine.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('engine.ts',source,ts.ScriptTarget.Latest,true),functions=ast.statements.filter(ts.isFunctionDeclaration).map(n=>n.getText(ast)).join('\n');
 const blocks=[];for(let z=0;z<3;z++)for(let y=0;y<3;y++)for(let x=0;x<3;x++)blocks.push({x,y,z,type:x===1&&y===1?'support':'standard',color:x===0?'#ff321c':'#245bca'});
 const context=vm.createContext({THREE,DEFAULT_BLOCK_COLOR:'#e93222',model:{gridWidth:16,gridDepth:16,getBlocks:()=>blocks}});vm.runInContext(ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 const worker=vm.createContext({THREE});vm.runInContext(generateSmoothKernel(source).replace("import * as THREE from 'three';",'').replace('export function','function'),worker);
 for(const style of ['classic','rounded'])for(const strength of [1,3,5]){const standard=blocks.filter(b=>b.type==='standard'),g=context.createOversampledLayerSdfGeometry(standard,1,strength,{quality:'export',style});context.addSmoothBlockColors(g,standard,1);const result=worker.buildSmoothPayload({blocks,gridWidth:16,gridDepth:16,strength,style});for(const name of ['position','normal','color'])assert.deepEqual(Buffer.from(result[name].buffer),Buffer.from(g.getAttribute(name).array.buffer),name+' changed');assert.deepEqual(Array.from(result.triangleColorIndices),Array.from(g.userData.triangleColorIndices));assert.deepEqual(Array.from(result.userData.colorPalette),Array.from(g.userData.colorPalette));g.dispose();}
});
