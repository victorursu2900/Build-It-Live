import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Guide reads Introduction -> Hardware Builder -> Brick Maker -> Digital Builder', () => {
  const page = read('../src/components/TutorialContent.tsx');
  const anchors = ['id="guide-introduction"', '<HardwareAssemblyGuide />', 'id="brick-maker-guide"', 'id="digital-builder-guide"'];
  const starts = anchors.map(anchor => page.indexOf(anchor));
  assert.ok(starts.every(start => start >= 0), 'Each chapter must exist');
  assert.deepEqual(starts, [...starts].sort((a,b) => a-b));
  assert.match(page, /<h1 id="tutorialHeroTitle">/);
  assert.match(page, /<h2 id="brickMakerGuideTitle">/);
  assert.match(page, /<h2 id="digitalGuideTitle">/);
  assert.equal((page.match(/<InteractiveWalkthrough \/>/g)||[]).length,1);
  assert.ok(page.indexOf('className="system-overview"') < page.indexOf('<InteractiveWalkthrough />'));
  assert.ok(page.indexOf('<InteractiveWalkthrough />') < page.indexOf('className="quick-reference glass-card"'));
});

test('Guide jump navigation uses real chapter ids', () => {
  const page=read('../src/components/TutorialContent.tsx');
  const hw=read('../src/components/HardwareAssemblyGuide.tsx');
  for(const fragment of ['hardware-guide','brick-maker-guide','digital-builder-guide']) {
    assert.ok(page.includes(`href="#${fragment}"`));
    assert.ok(page.includes(`id="${fragment}"`) || hw.includes(`id="${fragment}"`));
  }
  assert.match(hw, /id="hwg-bom"/);
  assert.match(hw, /id="hwg-print"/);
  assert.match(hw, /id="hwg-assembly"/);
  assert.match(hw, /id="hwg-wiring"/);
  assert.match(hw, /id="hwg-firmware"/);
  assert.match(hw, /id="hwg-connect"/);
});

test('Hardware documentation matches the 2x4 physical-grid design and firmware limit', () => {
  const hw=read('../src/components/HardwareAssemblyGuide.tsx');
  assert.match(hw, /2-column × 4-row physical grid/);
  assert.match(hw, /automatically matches the physical grid/);
  assert.match(hw, /channel 0 only/);
  assert.match(hw, /no Load Project button/);
  assert.doesNotMatch(hw, /digital grid must be/);
  assert.doesNotMatch(hw, /square physical grid configured up to 8×8/);
});

test('Digital Builder tutorial is explicitly digital and uses semantic headings', () => {
  const steps=read('../src/domain/tutorialContent.ts');
  const walk=read('../src/components/InteractiveWalkthrough.tsx');
  assert.match(steps,/In Digital Builder, you control these positions directly/);
  assert.match(walk, /03\.02–03\.08 \/ DIGITAL BUILDER WALKTHROUGH/);
  assert.match(walk, /<h4>\$\{step\.title\}<\/h4>/);
});
