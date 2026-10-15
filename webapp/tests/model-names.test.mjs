import assert from 'node:assert/strict';
import test from 'node:test';
import { safeModelFilename } from '../src/domain/modelFilenames.ts';

test('exported files use current user-supplied name without timestamps', () => {
  assert.equal(safeModelFilename('My Shape 02', 'stl'), 'My Shape 02.stl');
  assert.equal(safeModelFilename('Renamed Model', '3mf'), 'Renamed Model.3mf');
  assert.equal(safeModelFilename('Renamed Model', 'bil'), 'Renamed Model.bil');
  assert.equal(safeModelFilename('Renamed Model', 'json'), 'Renamed Model.json');
});
test('preserves safe unicode names and sanitizes filesystem-unsafe names', () => {
  assert.equal(safeModelFilename('Căsuța mea', 'obj'), 'Căsuța mea.obj');
  assert.equal(safeModelFilename('A/B:C*D?', 'glb'), 'ABCD.glb');
  assert.equal(safeModelFilename('   ', 'stl'), 'Build It Live.stl');
  assert.equal(safeModelFilename('CON', 'bil'), '_CON.bil');
});
