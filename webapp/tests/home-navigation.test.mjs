import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('default home mounts Hardware Builder while Digital Builder is separate', () => {
  assert.match(read('index.html'), /src="\/src\/index\.tsx"/);
  assert.match(read('src/index.tsx'), /import '\.\/hardware'/);
  assert.match(read('src/hardware.tsx'), /mode="hardware"/);
  assert.match(read('digital.html'), /src="\/src\/digital\.tsx"/);
  assert.match(read('src/digital.tsx'), /mode="digital"/);
  assert.match(read('hardware.html'), /src="\/src\/hardware\.tsx"/);
  assert.match(read('vite.config.ts'), /digital: resolve\(.+digital\.html/);
});

test('all headers navigate hardware first, preserving active state', () => {
  for (const file of ['BuilderHeader.tsx','TutorialHeader.tsx','BrickMakerHeader.tsx']) {
    const header = read(`src/components/${file}`);
    assert.ok(header.indexOf('>HARDWARE BUILDER</a>') < header.indexOf('>DIGITAL BUILDER</a>'), file);
    assert.match(header, /href="\.\/index\.html"[^>]*>HARDWARE BUILDER<\/a>/);
    assert.match(header, /href="\.\/digital\.html"[^>]*>DIGITAL BUILDER<\/a>/);
  }
});

test('digital guide and final tutorial link still open Digital Builder', () => {
  assert.match(read('src/components/TutorialContent.tsx'), /href="\.\/digital\.html">OPEN DIGITAL BUILDER/);
  assert.match(read('src/components/InteractiveWalkthrough.tsx'), /window\.location\.href = '\.\/digital\.html'/);
});

test('guide display headings render bold non-italic words ahead of serif accents', () => {
  const css = read('src/tutorial.css');
  assert.match(css, /V54 \/ Guide heading hierarchy/);
  for (const name of ['hwg-section-heading h3','guide-brick-note h3','guide-digital-hero h2','guide-workflows__intro h2']) {
    assert.ok(css.includes(name), name);
  }
  assert.match(css, /font-weight: 900;/);
  assert.match(css, /font-style: italic;/);
});
