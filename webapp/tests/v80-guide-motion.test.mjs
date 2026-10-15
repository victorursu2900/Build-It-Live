import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const app = read('../src/pages/TutorialApp.tsx');
const assembly = read('../src/components/HardwareAssemblyGuide.tsx');
const experiments = read('../src/components/GuideExperiments.tsx');
const walkthrough = read('../src/components/InteractiveWalkthrough.tsx');
const guide = read('../src/components/TutorialContent.tsx');
const css = read('../src/guide-interactive.css');

test('reading sequences play once on intersection and clean up', () => {
  assert.match(app, /guide-sequence-played/);
  assert.match(app, /sequenceObserver\?\.observe/);
  assert.match(app, /observer\.unobserve\(entry\.target\)/);
  assert.match(app, /sequenceObserver\?\.disconnect\(\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(css, /concept-map\.guide-sequence-played/);
});

test('assembly labels and BOM quantities animate on selection, not on every scroll frame', () => {
  assert.match(assembly, /className="guide-motion-swap" key=\{build\}/);
  assert.match(assembly, /className="guide-assembly-caption" key=\{assemblyStage\}/);
  assert.match(css, /\.guide-motion-swap \{animation:guide-v80-swap/);
  assert.match(css, /\.guide-assembly-caption \{animation:guide-v80-swap/);
  assert.doesNotMatch(css, /animation-iteration-count:\s*infinite/);
});

test('interactive demos keep input focus stable and announce example feedback', () => {
  assert.match(experiments, /role="status"/);
  assert.match(experiments, /aria-pressed/);
  assert.doesNotMatch(experiments, /key=\{count\}|key=\{cells\.slice/);
  assert.doesNotMatch(experiments, /navigator\.serial|requestPort/);
});

test('Digital Builder tutorial only animates existing steps; practice grid stays removed', () => {
  assert.match(walkthrough, /key=\{active\} className="step-content(?: digital-walk-content)?"/);
  assert.match(css, /\.step-content \{animation:guide-v80-swap/);
  assert.doesNotMatch(guide, /DigitalBuildDemo|DigitalBuilderPractice/);
  assert.doesNotMatch(experiments, /DigitalBuildDemo|DigitalBuilderPractice/);
});

test('added motion has a complete reduced-motion disable and remains guide scoped', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.guide-brick-preview__grid--motion/);
  assert.match(css, /\.concept-map\.guide-sequence-played/);
  assert.match(css, /animation:none!important/);
  assert.match(css, /transition:none!important/);
  assert.doesNotMatch(css, /html\s*\{|body\s*\{/);
});
