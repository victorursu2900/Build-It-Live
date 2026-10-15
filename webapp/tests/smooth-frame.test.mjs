import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothWorkspaceOrigin, smoothCellToWorld } from '../src/domain/smoothWorkspaceFrame.ts';

test('8x16 smooth origin respects the 40x20 mm rectangular modules', () => {
  assert.deepEqual(smoothWorkspaceOrigin(8,16,2,1), {x:-8,y:0,z:8});
  assert.deepEqual(smoothWorkspaceOrigin(8,16,2,1,20), {x:-160,y:0,z:160});
});
test('SMOOTH centers coincide with Builder cells, including far edges', () => {
  assert.deepEqual(smoothCellToWorld(0,0,0,8,16,2,1,0.925), {x:-7,y:0.4625,z:7.5});
  assert.deepEqual(smoothCellToWorld(7,15,2,8,16,2,1,0.925), {x:7,y:2.3125,z:-7.5});
});
