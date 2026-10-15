import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceModeFilename } from '../src/domain/modelFilenames.ts';

test('switching a loaded Smooth model to Blocks replaces the stale mode suffix', () => {
  assert.equal(surfaceModeFilename('My Model - Smooth', 'voxel', 'png'), 'My Model - Blocks.png');
  assert.equal(surfaceModeFilename('My Model - Smooth', 'voxel', 'gif'), 'My Model - Blocks.gif');
  assert.equal(surfaceModeFilename('My Model - Smooth', 'voxel', 'stl'), 'My Model - Blocks.stl');
});

test('the active Smooth view always wins over an old Blocks suffix', () => {
  assert.equal(surfaceModeFilename('My Model - Blocks', 'soft1', 'glb'), 'My Model - Smooth.glb');
  assert.equal(surfaceModeFilename('My Model - Smooth - Blocks', 'soft1', '3mf'), 'My Model - Smooth.3mf');
});

test('user names are preserved when no suffix represents a display mode', () => {
  assert.equal(surfaceModeFilename('Smooth Architecture', 'voxel', 'png'), 'Smooth Architecture - Blocks.png');
  assert.equal(surfaceModeFilename('Tower : 01', 'soft1', 'gif'), 'Tower 01 - Smooth.gif');
});
