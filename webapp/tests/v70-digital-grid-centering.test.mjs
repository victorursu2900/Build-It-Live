import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { centerWorkspaceBlocks } from '../src/domain/centerWorkspaceBlocks.ts';
import { VoxelModel } from '../src/domain/VoxelModel.ts';

const engine = readFileSync(new URL('../src/engine/builderEngine.ts', import.meta.url), 'utf8');

function block(x, y, z = 0, color = '#e93222', type = 'standard') {
  return { x, y, z, color, type };
}

function runResize({ startSize = 4, nextSize = 6, blocks = [block(0, 0)], hardware = false, preserveBlocks = true, selected = [] } = {}) {
  const model = new VoxelModel({ gridSize: 16, maxHeight: 16 });
  model.setGridDimensions(startSize, startSize * 2);
  const bad = model.replaceExact(blocks);
  assert.equal(bad.length, 0, 'input model is valid');
  const signals = { feedback: null, autosaves: 0, renders: 0, resets: 0, recolorUpdates: 0 };
  const env = {
    model, IS_HARDWARE_BUILDER: hardware, CONFIG: { WORKSPACE_COLUMNS: 8, MIN_GRID_SIZE: 1 },
    exactImportedStl: null, serialConnected: false, simulationActive: false,
    centerWorkspaceBlocks, recolorSelectedKeys: new Set(selected),
    modelBlockKey: (x, y, z) => `${x},${y},${z}`,
    updateRecolorTargetUi: () => { signals.recolorUpdates++; },
    cloneBlocks: () => structuredClone(model.getBlocks()),
    clampGridSize: n => Math.max(1, Math.min(8, Number(n))),
    updateGridUi: () => {},
    updateGridSceneGeometry: () => {},
    ghost: { visible: false }, hoveredCandidate: null,
    setLayerView: () => {},
    syncViewFromModel: () => { signals.renders++; },
    resetHistoryToCurrent: () => { signals.resets++; },
    scheduleAutosave: () => { signals.autosaves++; },
    systemStatus: { textContent: '' },
    setFeedback: (...args) => { signals.feedback = args; },
  };
  vm.createContext(env);
  const from = engine.indexOf('function setActiveGridSize(');
  const to = engine.indexOf('\nfunction snapshotSignature(', from);
  assert.ok(from !== -1 && to !== -1, 'Digital Builder resize implementation exists');
  vm.runInContext(engine.slice(from, to), env);
  const resized = env.setActiveGridSize(nextSize, { preserveBlocks, silent: false, autosave: true });
  return { model, signals, env, resized };
}

test('4×8 to 6×12 centers the entire occupied shape, not the original grid or only out-of-bounds blocks', () => {
  const original = [block(0,0,0), block(1,0,0), block(1,1,0), block(1,1,1,'#1199aa')];
  const output = centerWorkspaceBlocks(original, 6, 12);
  assert.equal(output.fits, true);
  assert.deepEqual([output.offsetX, output.offsetY], [2,5]);
  assert.deepEqual(output.blocks.map(b => [b.x,b.y,b.z]), [[2,5,0],[3,5,0],[3,6,0],[3,6,1]]);
  assert.equal(output.blocks[3].color, '#1199aa');
  assert.deepEqual(original[0], block(0,0,0), 'the original input is not mutated');
});

test('odd spare cells choose stable integer alignment without deforming the model', () => {
  const source = [block(0,0,0), block(0,1,0), block(0,1,1)];
  const out = centerWorkspaceBlocks(source, 4, 7);
  assert.deepEqual([out.offsetX, out.offsetY], [1,2]);
  assert.deepEqual(out.blocks.map(b => [b.x,b.y,b.z]), [[1,2,0],[1,3,0],[1,3,1]]);
});

test('shrinking centers a model when it fits and rejects without dropping blocks if it does not', () => {
  const shape = [block(4,8), block(5,8), block(5,9)];
  const fits = centerWorkspaceBlocks(shape, 4, 8);
  assert.equal(fits.fits, true);
  assert.deepEqual(fits.blocks.map(b => [b.x,b.y]), [[1,3],[2,3],[2,4]]);
  const tooBig = centerWorkspaceBlocks([block(0,0),block(4,0)], 4, 8);
  assert.equal(tooBig.fits, false);
  assert.deepEqual(tooBig.blocks, [block(0,0),block(4,0)]);
});

test('empty grid remains empty, at any valid size', () => {
  assert.deepEqual(centerWorkspaceBlocks([], 6, 12), { fits: true, shifted: false, offsetX: 0, offsetY: 0, blocks: [] });
});

test('actual Digital Builder resize updates dimensions, saved state, visualization and model selection', () => {
  const original = [block(0,0), block(1,0), block(1,0,1,'#0088cc')];
  const { model, signals, env, resized } = runResize({ blocks: original, selected: ['1,0,1'] });
  assert.equal(resized, true);
  assert.equal(`${model.gridWidth}×${model.gridDepth}`, '6×12');
  assert.deepEqual(model.getBlocks().map(b=>[b.x,b.y,b.z]), [[2,5,0],[3,5,0],[3,5,1]]);
  assert.deepEqual([...env.recolorSelectedKeys], ['3,5,1']);
  assert.equal(model.getBlock(3,5,1).color, '#0088cc');
  assert.equal(signals.autosaves, 1);
  assert.equal(signals.resets, 1);
  assert.ok(signals.renders > 0);
  assert.match(signals.feedback[1], /centered/i);
  assert.equal(env.systemStatus.textContent, 'GRID 6×12');
});

test('oversize reduction does not change the existing model, grid, or autosave', () => {
  const { model, signals, resized } = runResize({ startSize: 6, nextSize: 2, blocks: [block(0,0), block(4,0)] });
  assert.equal(resized, false);
  assert.equal(`${model.gridWidth}×${model.gridDepth}`, '6×12');
  assert.equal(model.getBlockCount(), 2);
  assert.equal(signals.autosaves, 0);
  assert.match(signals.feedback[1], /2×4/);
});

test('loading existing projects preserves saved coordinates; hardware sensor grids are not recentered', () => {
  const original = [block(0,0)];
  const restored = runResize({ startSize:4, nextSize:6, blocks:original, preserveBlocks:false });
  assert.deepEqual(restored.model.getBlocks().map(b=>[b.x,b.y]), [[0,0]], 'restoring does not recenter');
  const hardware = runResize({ startSize:4, nextSize:6, blocks:original, hardware:true });
  assert.deepEqual(hardware.model.getBlocks().map(b=>[b.x,b.y]), [[0,0]], 'physical cells never shift');
});
