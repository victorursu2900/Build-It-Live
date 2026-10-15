import test from 'node:test';
import assert from 'node:assert/strict';
import { installRailBounce } from '../src/ui/railBounce.ts';

test('one gentle bounce per boundary gesture, rearmed only by a new gesture or scrolling inward', () => {
  const before = {
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    WheelEvent: globalThis.WheelEvent,
    window: globalThis.window,
    performance: globalThis.performance,
  };
  let clock = 1000;
  try {
    class FakeElement {
      constructor() {
        this.scrollTop = 0;
        this.scrollHeight = 300;
        this.clientHeight = 100;
        this.children = [];
        this.listeners = new Map();
      }
      addEventListener(event, fn) { this.listeners.set(event, fn); }
      removeEventListener(event) { this.listeners.delete(event); }
    }
    globalThis.Element = FakeElement;
    globalThis.HTMLElement = FakeElement;
    globalThis.WheelEvent = { DOM_DELTA_PIXEL: 0 };
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    globalThis.performance = { now: () => clock };

    const root = new FakeElement();
    const rail = new FakeElement();
    const frames = [];
    const content = new FakeElement();
    content.animate = (keyframes, settings) => frames.push({ keyframes, settings });
    rail.children = [content];
    root.querySelectorAll = () => [rail];
    const cleanup = installRailBounce(root);
    const wheel = deltaY => rail.listeners.get('wheel')({
      target: rail, ctrlKey: false, deltaY, deltaMode: 0,
    });

    wheel(-80);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].keyframes.length, 3, 'exactly one outward-and-return movement');
    assert.match(frames[0].keyframes[1].transform, /8px/);
    assert.match(frames[0].keyframes[2].transform, /0, 0, 0/);

    for (clock = 1020; clock <= 2020; clock += 100) wheel(-50);
    assert.equal(frames.length, 1, 'continuous overscroll, including momentum, must not retrigger');

    clock = 3100;
    wheel(-50);
    assert.equal(frames.length, 2, 'another wheel gesture after a pause gets one bounce');

    rail.scrollTop = 80;
    rail.listeners.get('scroll')();
    rail.scrollTop = 200;
    clock = 3120;
    wheel(50);
    assert.equal(frames.length, 3, 'scrolling inward re-arms another edge');
    assert.match(frames[2].keyframes[1].transform, /-7\.5px/);
    clock = 3150;
    wheel(50);
    assert.equal(frames.length, 3, 'bottom bounce must not repeat within same gesture');

    cleanup();
    assert.equal(rail.listeners.has('wheel'), false);
    assert.equal(rail.listeners.has('scroll'), false);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
