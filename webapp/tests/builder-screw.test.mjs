import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDER_SCREW_GRID, screwWorkspaceSize, screwModelCenter } from '../src/domain/builderScrewLayout.ts';
import { VoxelModel } from '../src/domain/VoxelModel.ts';
import { validateGridMapping } from '../src/domain/hardwareRules.ts';
test('8×16 rectangular screw workspace is 320×320 mm', () => {
  assert.deepEqual(BUILDER_SCREW_GRID, {columns:8,rows:16});
  assert.deepEqual(screwWorkspaceSize(), {widthMm:320, depthMm:320});
});
test('module centers use a 40×20×18.5 mm pitch', () => {
  const left=screwModelCenter(0,0,0), right=screwModelCenter(1,0,0), next=screwModelCenter(0,1,0), above=screwModelCenter(0,0,1);
  assert.equal(right.x-left.x,40);
  assert.equal(next.y-left.y,20);
  assert.equal(above.z-left.z,18.5);
});
test('standard and support place in rectangular workspace', () => {
  const model=new VoxelModel({gridSize:16,maxHeight:16});
  model.setGridDimensions(8,16);
  assert.equal(model.placeBlock(7,15,0,'standard').valid,true);
  assert.equal(model.placeBlock(7,15,1,'support').valid,true);
  assert.equal(model.placeBlock(8,15,0,'standard').valid,false);
  assert.equal(model.placeBlock(7,16,0,'standard').valid,false);
  assert.equal(model.getBlocks().length,2);
});
test('hardware grid mapping allows equal grid and 4×4 physical in 8×16 digital', () => {
  assert.doesNotThrow(()=>validateGridMapping(4,8,16));
  assert.doesNotThrow(()=>validateGridMapping(8,8,16));
});
