import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installRailBounce } from '../src/ui/railBounce.ts';
const read = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('V67 does not toggle overflow locks; native scroll works as soon as content exceeds the rail', () => {
  const previous = Object.fromEntries(['Element','HTMLElement','WheelEvent','window'].map(k=>[k,globalThis[k]]));
  try {
    class FakeNode {
      constructor(height, view) {this.scrollHeight=height;this.clientHeight=view;this.scrollTop=0;this.children=[];this.listeners=new Map();}
      addEventListener(k,cb){this.listeners.set(k,cb);}
      removeEventListener(k){this.listeners.delete(k);}
    }
    globalThis.Element=globalThis.HTMLElement=FakeNode;
    globalThis.WheelEvent={DOM_DELTA_PIXEL:0};
    globalThis.window={matchMedia:()=>({matches:false})};
    const root=new FakeNode(0,0),rail=new FakeNode(100,100);
    const frames=[];
    const child=new FakeNode(10,10);
    child.animate=(keyframes,settings)=>frames.push({keyframes,settings});
    rail.children=[child];root.querySelectorAll=()=>[rail];
    const cleanup=installRailBounce(root);
    rail.listeners.get('wheel')({target:rail,deltaY:-90,deltaMode:0,ctrlKey:false});
    assert.equal(frames.length,0,'compact rail has no bounce');
    rail.scrollHeight=220;
    rail.listeners.get('wheel')({target:rail,deltaY:-90,deltaMode:0,ctrlKey:false});
    assert.equal(frames.length,1,'expanding a feature immediately enables end feedback');
    assert.equal(frames[0].settings.duration,460);
    assert.equal(frames[0].keyframes.length,3);
    rail.scrollHeight=100;
    rail.listeners.get('wheel')({target:rail,deltaY:-90,deltaMode:0,ctrlKey:false});
    assert.equal(frames.length,1,'closed rail again has no bounce');
    cleanup();
    assert.equal(rail.listeners.has('wheel'),false);
  } finally {for(const [key,value] of Object.entries(previous)) {if(value===undefined) delete globalThis[key];else globalThis[key]=value;}}
});

test('Hardware Inspector moves sections upward and adds space below Layer View', () => {
  const css=read('hardware-builder.css');
  const section=css.split('V66 / More visible air below Layer View')[1];
  assert.ok(section);
  for (const selector of ['.stats-panel','.hardware-diagnostics','.feedback-card','.feature-panel']) assert.ok(section.includes(selector));
  assert.match(section,/padding-bottom:\s*32px/);
  const shared=read('studio.css');
  assert.match(shared, /V67 \/ Side rails use native, content-driven scrolling/);
  assert.match(shared, /overflow-y: auto !important;/);
  assert.doesNotMatch(shared, /\.studio-rail-scroll\.is-rail-static/);
});
