import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readEditableStateFromStl } from '../src/domain/stlEditableState.ts';
import { getStlPreviewLayout } from '../src/domain/stlPreviewLayout.ts';

const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
const loader = engine.slice(engine.indexOf('async function loadStlBlocks('), engine.indexOf('async function decodeModelFile('));

test('mesh-only STL never enters cubic-surface approximation and is retained losslessly', async () => {
  const b = new Uint8Array(84 + 12 * 50);
  b.set(new TextEncoder().encode('BUILD IT LIVE / STATIC STL EXPORT'));
  new DataView(b.buffer).setUint32(80, 12, true);
  const mesh = {boundingBox:null, getAttribute:()=>({count:36}), computeBoundingBox(){this.boundingBox={min:{x:69.034,y:75.377,z:0},max:{x:251.28,y:225.64,z:259},isEmpty:()=>false}},dispose(){throw Error('Unexpected geometry disposal')}};
  const env={TextDecoder,Uint8Array,Math,Number,CONFIG:{GRID_SIZE:16,PHYSICAL_BLOCK_MM:20,MAX_HEIGHT:16},getStlPreviewLayout,readEditableStateFromStl,
    getEditableStlExportSnapshot:async()=>null,extractVoxelStateFromBinaryStl:()=>null,decodeCompactStlMetadataFromBuffer:()=>null,extractStlExportId:()=>null,recoverRegisteredStlState:()=>null,recoverLegacyStlStateFromRecents:()=>null,isClearlyLegacyVoxelStl:()=>false,
    STLLoader:class{parse(){return mesh;}}};
  vm.createContext(env);vm.runInContext(loader,env);
  const r=await env.loadStlBlocks({name:'CHURCH.stl',arrayBuffer:async()=>b.buffer});
  assert.equal(r.exactStl.buffer,b.buffer);
  assert.equal(r.exactStl.geometry,mesh);
  assert.equal(r.exactStl.previewBlocks,undefined);
  assert.equal(r.gridWidth,5);assert.equal(r.gridDepth,8);
  assert.doesNotMatch(loader,/approximateStlAsBlocks/);
});

test('Blocks reference switches shader only, never mesh geometry or phantom cubes',()=>{
  const sync=engine.slice(engine.indexOf('function syncViewFromModel('),engine.indexOf('// -----------------------------------------------------------------------------\n// 7. RAYCASTING'));
  assert.match(sync,/exactStlGroup\.visible = true/);
  assert.match(sync,/blocksGroup\.visible = false/);
  assert.match(sync,/importedMesh.material = isImportedGridReferenceView\(\) \? exactStlGridMaterial : exactStlMaterial/);
  assert.match(engine,/const exactStlGridMaterial = exactStlMaterial.clone\(\)/);
  assert.match(engine,/gl_FragColor.rgb = mix/);
  const action=engine.slice(engine.indexOf('function handleCanvasAction('),engine.indexOf('function canUseDigitalEditing('));
  assert.match(action,/setFeedback\('ORIGINAL STL', 'Exact blocks unavailable/);
  assert.doesNotMatch(action,/beginEditingApproximateBlocks/);
  assert.match(engine,/const meshLocked = Boolean\(exactImportedStl\)/);
});

test('new STL block data still takes precedence over mesh-only fallback',()=>{
  assert.ok(loader.indexOf('await getEditableStlExportSnapshot(buffer)') < loader.indexOf('exactStl: { buffer, geometry'));
  assert.ok(loader.indexOf('readEditableStateFromStl(buffer)') < loader.indexOf('exactStl: { buffer, geometry'));
  assert.match(engine,/exactImportedStl.originalBuffer.slice\(0\)/);
  assert.doesNotMatch(loader,/previewBlocks/);
});
