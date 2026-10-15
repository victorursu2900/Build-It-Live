import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGridMapping, matchSensorResistance, resistanceFromConductance, sensorChannelToCell, hardwareDigitalDimensions } from '../src/domain/hardwareRules.ts';
import { VoxelModel } from '../src/domain/VoxelModel.ts';

// Grid dimensions may be equal; the rule is >=, not >.
test('4×4 physical may map to a 4×4 digital build area', () => {
  assert.doesNotThrow(() => validateGridMapping(4,4,4));
});
test('rectangular and maximum equal grids are accepted', () => {
  assert.doesNotThrow(() => validateGridMapping(4,4,6));
  assert.doesNotThrow(() => validateGridMapping(16,16,16));
});
test('a digital grid cannot be smaller on either axis', () => {
  assert.throws(() => validateGridMapping(4,3,6));
  assert.throws(() => validateGridMapping(4,6,3));
  assert.throws(() => validateGridMapping(16,16,17));
});
test('sensor conductance converts to kOhms and matches configured profiles', () => {
  const profiles = [
    { resistance:10, type:'standard', color:'#e93222' },
    { resistance:5.1, type:'support', color:'#dde1df' },
    { resistance:20, type:'standard', color:'#348dc1' },
  ];
  assert.equal(resistanceFromConductance(100),10);
  assert.equal(matchSensorResistance(100,profiles)?.resistance,10);
  assert.equal(matchSensorResistance(1000/5.1,profiles)?.type,'support');
  assert.equal(matchSensorResistance(50,profiles)?.resistance,20);
  assert.equal(matchSensorResistance(-1,profiles),null);
  assert.equal(matchSensorResistance(1,profiles),null);
});
test('rectangular VoxelModel enforces independent bounds and gravity', () => {
  const model = new VoxelModel({gridSize: 4, maxHeight: 16});
  model.setGridDimensions(4,6);
  assert.equal(model.placeBlock(3,5,0,'standard','#e93222').valid,true);
  assert.equal(model.placeBlock(4,0,0).valid,false);
  assert.equal(model.placeBlock(0,6,0).valid,false);
  assert.equal(model.placeBlock(3,5,2).valid,false);
  assert.equal(model.placeBlock(3,5,1,'support').valid,true);
  assert.equal(model.removeBlockAndApplyGravity(3,5,0).removed,true);
  assert.equal(model.get(3,5,0),'support');
});

// Physical channel positions are identical in real and simulated sessions.
test('sensor mapping centers the physical board and permits equal sizes', () => {
  assert.deepEqual(sensorChannelToCell(0,4,4,4), {x:0,y:0});
  assert.deepEqual(sensorChannelToCell(15,4,4,4), {x:3,y:3});
  assert.deepEqual(sensorChannelToCell(0,4,6,8), {x:1,y:2});
  assert.deepEqual(sensorChannelToCell(15,4,6,8), {x:4,y:5});
  assert.throws(() => sensorChannelToCell(16,4,4,4));
});

test('physical dimensions are the single source for hardware digital dimensions', () => {
  assert.deepEqual(hardwareDigitalDimensions(4), {width:4, depth:4});
  assert.deepEqual(hardwareDigitalDimensions(8), {width:8, depth:8});
  assert.deepEqual(sensorChannelToCell(0,4,4,4), {x:0,y:0});
  assert.deepEqual(sensorChannelToCell(15,4,4,4), {x:3,y:3});
  assert.throws(() => hardwareDigitalDimensions(0));
  assert.throws(() => hardwareDigitalDimensions(9));
  assert.throws(() => hardwareDigitalDimensions(4.5));
});

test('rectangular 2×4 board maps eight channels one-to-one into the physical workspace', () => {
  assert.deepEqual(hardwareDigitalDimensions(2,4), {width:2,depth:4});
  const expected = [
    {x:0,y:0}, {x:1,y:0},
    {x:0,y:1}, {x:1,y:1},
    {x:0,y:2}, {x:1,y:2},
    {x:0,y:3}, {x:1,y:3},
  ];
  expected.forEach((pos, ch) => assert.deepEqual(sensorChannelToCell(ch,2,2,4,4),pos));
  assert.throws(() => sensorChannelToCell(8,2,2,4,4));
  assert.throws(() => validateGridMapping(2,2,3,16,4));
  assert.deepEqual(sensorChannelToCell(7,2,6,8,4),{x:3,y:5});
  assert.throws(() => hardwareDigitalDimensions(2,9));
});
