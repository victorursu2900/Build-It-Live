import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workspaceBlockDimensionsMm, groupWorkspaceBlocks } from '../src/domain/workspaceExport.ts';

const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');
const brickMaker = readFileSync(new URL('../src/engine/brickMakerEngine.ts', import.meta.url), 'utf8');
const color = value => /^#[0-9a-f]{6}$/i.test(value ?? '') ? value.toLowerCase() : '#e93222';

test('workspace export cuboids match the actual on-screen 40 × 20 × 18.5 mm blocks', () => {
  const unit = workspaceBlockDimensionsMm(2, 1, 0.925, 20);
  assert.deepEqual(unit, { width: 40, depth: 20, height: 18.5 });
  const meters = workspaceBlockDimensionsMm(2, 1, 0.925, 0.02);
  assert.ok(Math.abs(meters.width - 0.04) < 1e-10);
  assert.ok(Math.abs(meters.depth - 0.02) < 1e-10);
  assert.ok(Math.abs(meters.height - 0.0185) < 1e-10);
});

test('workspace colors create independent export regions without replacing grid positions', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, type: 'standard', color: '#e93222' },
    { x: 1, y: 0, z: 0, type: 'standard', color: '#E93222' },
    { x: 1, y: 1, z: 0, type: 'standard', color: '#3080ee' },
    { x: 0, y: 0, z: 1, type: 'support' },
  ];
  const groups = groupWorkspaceBlocks(blocks, color);
  assert.deepEqual(groups.map(({type,color,blocks}) => ({type,color,positions:blocks.map(({x,y,z})=>[x,y,z])})), [
    { type: 'standard', color: '#e93222', positions: [[0,0,0],[1,0,0]] },
    { type: 'standard', color: '#3080ee', positions: [[1,1,0]] },
    { type: 'support', color: '#dde1df', positions: [[0,0,1]] },
  ]);
});

test('all four generated geometry formats use workspace prisms instead of screw STL', () => {
  const generatedExporter = engine.slice(engine.indexOf('function makeWorkspaceExportGroup('), engine.indexOf('function createLinearChamferPrismGeometry('));
  const threeMf = engine.slice(engine.indexOf('function getThreeMfVoxelMesh('), engine.indexOf('function getThreeMfSmoothMesh('));
  const formatSwitch = engine.slice(engine.indexOf('async function exportModel('), engine.indexOf('// -----------------------------------------------------------------------------\n// ORGANIC PRINT', engine.indexOf('async function exportModel(')));
  assert.match(generatedExporter, /buildVoxelSurface\(blocks, block =>/);
  assert.match(generatedExporter, /point\[0\] \* dimensions\.width \* unitScale/);
  assert.match(generatedExporter, /facesByMaterial/);
  assert.match(generatedExporter, /respectColors \? normalizeStandardBlockColor\(block\.color\) : DEFAULT_BLOCK_COLOR/);
  assert.match(threeMf, /buildVoxelSurface\(blocks, block => normalizeStandardBlockColor\(block\.color\)\)/);
  assert.doesNotMatch(generatedExporter + threeMf, /buildScrewLayerGeometry|mergeScrewSurfaces|screwSourcePositions|blockScrew\.stl/);
  assert.match(formatSwitch, /makeSlicerExportGroup\(1, \{ includeSupportFrames: false, respectColors: false \}\)/); // STL: one solid despite colors
  assert.match(formatSwitch, /makeSlicerExportGroup\(1\)/); // OBJ
  assert.match(formatSwitch, /makeGeometryExportGroup\(0\.001\)/); // GLB
  assert.match(formatSwitch, /makeBambuThreeMfBlob\(\)/); // 3MF uses the shared mesh builder
  assert.match(engine, /\? getThreeMfSmoothMesh\(CONFIG\.PHYSICAL_BLOCK_MM\)\s*:\s*getThreeMfVoxelMesh\(1\)/);
  assert.match(brickMaker, /blockScrew\.stl/); // physical Brick Maker unchanged
});

test('Hardware Builder can enable live Smooth mode after sensor connection', () => {
  const locks = engine.slice(engine.indexOf('function updateOrganicEditingLocks('), engine.indexOf('function setExportSurfaceMode('));
  const mode = engine.slice(engine.indexOf('function setExportSurfaceMode('), engine.indexOf('function openSaveModal('));
  assert.match(locks, /button\.disabled = sensorLocked && !IS_HARDWARE_BUILDER/);
  assert.match(locks, /realtimeSmoothingSlider\.disabled = sensorLocked && !IS_HARDWARE_BUILDER/);
  assert.match(mode, /!IS_HARDWARE_BUILDER && \(serialConnected \|\| simulationActive\)/);
  assert.match(engine, /function applyHardwareFrame\([\s\S]*?syncViewFromModel\(\)/);
  assert.match(engine, /function syncViewFromModel\([\s\S]*?scheduleRealtimeOrganicSurface\(\)/);
  const scheduler = engine.slice(engine.indexOf('function scheduleRealtimeOrganicSurface('), engine.indexOf('function makeObjMetadataHeader('));
  assert.match(scheduler, /liveSensorSmooth && !immediate && realtimeSmoothTimer !== null/);
  // The current renderer deliberately waits for two frames, so the UPDATING state is visible.
  assert.match(scheduler, /realtimeSmoothTimer = null;\s*setRealtimeSmoothingState\('BUILDING…'\)/);
  assert.match(scheduler, /realtimeSmoothTask=rebuildRealtimeOrganicSurface\(revision\)/);
});
