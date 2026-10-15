import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { approximateStlAsBlocks } from '../src/domain/stlToBlocks.ts';
import { readEditableStateFromStl } from '../src/domain/stlEditableState.ts';
import { getStlPreviewLayout } from '../src/domain/stlPreviewLayout.ts';

const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
const loader = engine.slice(engine.indexOf('async function loadStlBlocks('), engine.indexOf('async function decodeModelFile('));
function cube(x0=0,y0=0,z0=0,x1=40,y1=20,z1=18.5) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return new Float32Array(faces.flatMap(f => f.flatMap(i => v[i])));
}

test('old smooth STL keeps its untouched mesh plus a separate approximate Blocks view', async () => {
  const vertices=cube();
  const geometry={
    boundingBox: null,
    getAttribute:()=>({count:vertices.length/3, array:vertices}),
    computeBoundingBox() {this.boundingBox={min:{x:0,y:0,z:0},max:{x:40,y:20,z:18.5},isEmpty:()=>false};},
    dispose() { throw new Error('Mesh should not be discarded'); },
  };
  const bytes = new Uint8Array(84 + 12*50);
  bytes.set(new TextEncoder().encode('BUILD IT LIVE / STATIC STL EXPORT'),0);
  new DataView(bytes.buffer).setUint32(80,12,true);
  const env={
    TextDecoder,Uint8Array,Math,Number,console,
    CONFIG:{GRID_SIZE:16,PHYSICAL_BLOCK_MM:20,CELL_WIDTH:2,CELL_DEPTH:1,CELL_HEIGHT:.925,MAX_HEIGHT:16},
    getStlPreviewLayout, readEditableStateFromStl, approximateStlAsBlocks,
    getEditableStlExportSnapshot:async()=>null,extractVoxelStateFromBinaryStl:()=>null,
    decodeCompactStlMetadataFromBuffer:()=>null, extractStlExportId:()=>null,
    recoverRegisteredStlState:()=>null,recoverLegacyStlStateFromRecents:()=>null,
    isClearlyLegacyVoxelStl:()=>false,
    STLLoader:class {parse() {return geometry;}},
  };
  vm.createContext(env);vm.runInContext(loader,env);
  const result=await env.loadStlBlocks({name:'old_smooth.stl',arrayBuffer:async()=>bytes.buffer});
  assert.equal(result.exactStl.buffer,bytes.buffer);
  assert.equal(result.exactStl.geometry,geometry);
  assert.equal(result.blocks,undefined, 'Estimated blocks are not treated as original authored data');
  assert.equal(result.exactStl.previewBlocks,undefined);
});

test('switching between Smooth and Blocks keeps the exact geometry and changes material only',()=>{
  assert.match(engine,/exactStlGroup\.visible = true/);
  assert.match(engine,/blocksGroup\.visible = false/);
  assert.match(engine,/importedMesh.material = isImportedGridReferenceView\(\) \? exactStlGridMaterial : exactStlMaterial/);
  assert.match(engine,/if \(exactImportedStl\) \{\s*syncViewFromModel\(\);/);
  assert.match(engine,/setExportSurfaceMode\('soft1', \{ rebuild: false, remember: false \}\)/);
  assert.match(engine,/return 'STL SAVED \/ EXACT IMPORTED MESH PRESERVED'/);
});

test('original mesh is noneditable without actual cube metadata' ,()=>{
  const changeView=engine.slice(engine.indexOf('function setExportSurfaceMode('), engine.indexOf('function openSaveModal('));
  assert.doesNotMatch(changeView,/clearExactStlMode\(\)/);
  const action=engine.slice(engine.indexOf('function handleCanvasAction('),engine.indexOf('function canUseDigitalEditing('));
  assert.match(action,/Exact blocks unavailable\. Load the original \.BIL to edit/);
  assert.doesNotMatch(action,/beginEditingApproximateBlocks/);
  assert.match(engine,/Original blocks unavailable/);
});

test('original Standard/Support blocks still take priority over exact-mesh fallback' ,()=>{
  assert.ok(loader.indexOf('readEditableStateFromStl(buffer)') < loader.indexOf('exactStl: { buffer, geometry'));
  assert.ok(loader.indexOf('getEditableStlExportSnapshot(buffer)') < loader.indexOf('exactStl: { buffer, geometry'));
});
