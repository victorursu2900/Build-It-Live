import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildLibraryBackup, readStoredZipManifest, makeModelThumbnail, projectToBil, summarizeVersionDifference} from '../src/domain/projectLibraryTools.ts';
import {analyzeBlockPrintability, analyzeTriangleGeometry} from '../src/domain/printabilityReport.ts';
const engine=readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url),'utf8');
const recent=readFileSync(new URL('../src/components/RecentModelsDialog.tsx', import.meta.url),'utf8');
const exportUi=readFileSync(new URL('../src/components/ExportDialog.tsx', import.meta.url),'utf8');
test('library ZIP round trip preserves mode, block types, colors and named checkpoints', async()=>{
  const entries=[{mode:'digital',project:{id:'a',name:'Red church',savedAt:'2026-10-13T00:00:00Z',gridSize:4,gridWidth:4,gridDepth:8,surfaceMode:'soft1',blocks:[{x:1,y:2,z:0,type:'standard',color:'#e93222'},{x:2,y:2,z:0,type:'support'}],versions:[{id:'v1',label:'First roof',blocks:[{x:1,y:2,z:0,type:'standard'}]}]}},{mode:'hardware',project:{id:'b',name:'Physical',blocks:[{x:0,y:0,z:0,type:'standard'}]}}];
  const blob=buildLibraryBackup(entries);
  assert.equal(blob.type,'application/zip');
  const data=new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...data.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  assert.deepEqual(await readStoredZipManifest(data.buffer),entries);
  assert.equal(projectToBil(entries[0].project).model.blocks[1].type,'support');
});
test('corrupted ZIP manifest and invalid block data are refused',async()=>{
  const entry={mode:'digital',project:{id:'x',blocks:[{x:0,y:0,z:0,type:'standard'}]}};
  const bytes=new Uint8Array(await buildLibraryBackup([entry]).arrayBuffer());
  bytes[75]^=1;
  await assert.rejects(()=>readStoredZipManifest(bytes.buffer));
  const invalid=buildLibraryBackup([{mode:'digital',project:{id:'x',blocks:[{x:-1,y:0,z:0,type:'standard'}]}}]);
  await assert.rejects(()=>readStoredZipManifest(invalid.arrayBuffer()));
});
test('thumbnail is an SVG image and supports models without blocks',()=>{
  assert.match(makeModelThumbnail([]), /^data:image\/svg\+xml/);
  const svg=decodeURIComponent(makeModelThumbnail([{x:0,y:0,z:0,type:'standard',color:'#00aa00'}]));
  assert.match(svg,/#00aa00/);
  assert.match(svg,/<polygon/);
});
test('print preflight flags disconnected, floating and support blocks',()=>{
  const report=analyzeBlockPrintability([{x:0,y:0,z:0,type:'standard'},{x:3,y:3,z:2,type:'standard'},{x:3,y:3,z:1,type:'support'}],'soft1');
  assert.equal(report.status,'review');
  assert.equal(report.standardCount,2);
  assert.equal(report.supportCount,1);
  assert.ok(report.issues.some(x=>x.title==='SEPARATE PARTS'));
  assert.ok(report.issues.some(x=>x.title==='OVERHANGS TO REVIEW'));
});
test('mesh preflight identifies an open single triangle and a paired tetrahedron',()=>{
  const single=analyzeTriangleGeometry([0,0,0, 1,0,0, 0,1,0]);
  assert.equal(single.status,'review');
  const tetra=[
    0,0,0, 0,1,0, 1,0,0,
    0,0,0, 1,0,0, 0,0,1,
    0,0,0, 0,0,1, 0,1,0,
    1,0,0, 0,1,0, 0,0,1,
  ];
  assert.equal(analyzeTriangleGeometry(tetra).status,'ready');
});
test('all four features are available in the appropriate dialogs',()=>{
  assert.match(engine,/listEntireProjectLibrary/);
  assert.match(engine,/importProjectLibrary/);
  assert.match(engine,/checkpointRecentModel/);
  assert.match(engine,/restoreRecentVersion/);
  assert.match(engine,/makeModelThumbnail/);
  assert.match(engine,/updatePrintabilityReport/);
  assert.match(recent,/backupProjectLibrary/);
  assert.match(recent,/restoreProjectLibrary/);
  assert.match(exportUi,/printabilityReport/);
  assert.doesNotMatch(recent,/BUILD PLAYBACK/);
});

test('version comparisons detect block additions, removals and type or color changes',()=>{
  const before=[{x:0,y:0,z:0,type:'standard',color:'#aaaaaa'},{x:1,y:0,z:0,type:'support'}];
  const after=[{x:0,y:0,z:0,type:'standard',color:'#bbbbbb'},{x:2,y:0,z:0,type:'standard'}];
  assert.equal(summarizeVersionDifference(after,before),'VS CURRENT / +1 ADDED · −1 REMOVED · 1 CHANGED');
});
