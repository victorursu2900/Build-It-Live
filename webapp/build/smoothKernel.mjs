import fs from 'node:fs';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';
const sourcePath=fileURLToPath(new URL('../src/engine/builderEngine.ts',import.meta.url));
const functions=['normalizeStandardBlockColor','modelBlockKey','canonicalEdgeKey','snapDirectionToCadAngle','splitChainAtGridTurns','fitVectorLine','findVectorLineRuns','rasterMorph','closeRasterMask','chamferDistanceTo','blurScalarField2D','makeRasterLineDescriptor','localSmoothMax','localSmoothMin','localChamferMin','createOversampledLayerSdfGeometry','addSmoothBlockColors'];
/** Compile the actual engine functions into a DOM-free worker kernel. No second smoothing implementation. */
export function generateSmoothKernel(source){
 const ast=ts.createSourceFile('builderEngine.ts',source,ts.ScriptTarget.Latest,true),declarations=new Map(ast.statements.filter(ts.isFunctionDeclaration).map(n=>[n.name?.text,n.getText(ast)]));
 const code=functions.map(name=>{if(!declarations.has(name))throw Error('Missing smoothing kernel function: '+name);return declarations.get(name);}).join('\n');
 const color=ast.statements.filter(ts.isVariableStatement).flatMap(n=>n.declarationList.declarations).find(n=>n.name.getText(ast)==='DEFAULT_BLOCK_COLOR')?.initializer?.getText(ast);if(!color)throw Error('Missing smoothing default color');
 return `import * as THREE from 'three';
 export function buildSmoothPayload({blocks,gridWidth,gridDepth,strength,quality='export',style='classic'}){
 const model={gridWidth,gridDepth,getBlocks:()=>blocks};const DEFAULT_BLOCK_COLOR=${color};
 ${code}
 const standards=blocks.filter(b=>b.type!=='support');
 const geometry=createOversampledLayerSdfGeometry(standards,1,strength,{quality,style});
 if(!geometry)throw Error('No Standard surface to smooth');
 addSmoothBlockColors(geometry,standards,1);
 const {triangleColorIndices,...userData}=geometry.userData;
 const result={position:geometry.getAttribute('position').array,normal:geometry.getAttribute('normal').array,color:geometry.getAttribute('color').array,triangleColorIndices:new Uint32Array(triangleColorIndices),userData};
 geometry.dispose();return result;
 }`;
}
export function smoothKernelPlugin(){return {name:'bil-shared-smoothing-kernel',resolveId(id){if(id==='virtual:bil-smoothing-kernel')return '\0bil-smoothing-kernel';},load(id){if(id!=='\0bil-smoothing-kernel')return;this.addWatchFile(sourcePath);return generateSmoothKernel(fs.readFileSync(sourcePath,'utf8'));}};}
