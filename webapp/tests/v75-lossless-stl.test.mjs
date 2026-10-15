import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readEditableStateFromStl } from '../src/domain/stlEditableState.ts';
import { getStlPreviewLayout } from '../src/domain/stlPreviewLayout.ts';

const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
const source = engine.slice(engine.indexOf('async function loadStlBlocks('), engine.indexOf('async function decodeModelFile('));

function rawStaticStl() {
  const bytes = new Uint8Array(84 + 12 * 50);
  bytes.set(new TextEncoder().encode('BUILD IT LIVE / STATIC STL EXPORT'), 0);
  new DataView(bytes.buffer).setUint32(80, 12, true);
  return bytes.buffer;
}

test('legacy static smooth STL preserves mesh, bytes and no imagined supports', async () => {
  const sourceBuffer = rawStaticStl();
  const bounds = { min: { x: 69.03487, y: 75.37726, z: 0 }, max: { x: 251.2801, y: 225.64436, z: 259 } };
  const geometry = {
    boundingBox:null, getAttribute:() => ({ count: 36 }),
    computeBoundingBox() { this.boundingBox={...bounds,isEmpty:()=>false}; },
    dispose() { throw new Error('original mesh should be retained'); },
  };
  const env = {
    TextDecoder, Uint8Array, Math, Number, CONFIG: { GRID_SIZE:16, PHYSICAL_BLOCK_MM:20, MAX_HEIGHT:16 },
    getStlPreviewLayout, readEditableStateFromStl,
    getEditableStlExportSnapshot:async()=>null, extractVoxelStateFromBinaryStl:()=>null,
    decodeCompactStlMetadataFromBuffer:()=>null, extractStlExportId:()=>null,
    recoverRegisteredStlState:()=>null, recoverLegacyStlStateFromRecents:()=>null,
    isClearlyLegacyVoxelStl:()=>false, IS_HARDWARE_BUILDER:false,
    STLLoader:class { parse() {return geometry;} },
    approximateStlAsBlocks:()=>[{x:0,y:0,z:0,type:'standard',color:'#e93222'}],
  };
  vm.createContext(env); vm.runInContext(source,env);
  const result=await env.loadStlBlocks({name:'CHURCH.stl',arrayBuffer:async()=>sourceBuffer});
  assert.equal(result.exactStl.buffer, sourceBuffer);
  assert.equal(result.exactStl.geometry,geometry);
  assert.equal(result.blocks,undefined);
  assert.equal(result.exactStl.previewBlocks, undefined); 
  assert.equal(result.gridWidth,5);
  assert.equal(result.gridDepth,8);
  assert.match(result.note,/ORIGINAL STL GEOMETRY PRESERVED/);
  assert.doesNotMatch(source,/previewBlocks = approximateStlAsBlocks/);
});

test('imported STL receives no self-shadow and can re-export original bytes', () => {
  const preview=engine.slice(engine.indexOf('function activateExactStlMode('),engine.indexOf('function worldToBaseCell('));
  assert.match(preview,/mesh.castShadow = false/);
  assert.match(preview,/mesh.receiveShadow = false/);
  assert.match(engine,/exactImportedStl.originalBuffer.slice\(0\)/);
});
