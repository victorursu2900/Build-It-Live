import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const text=fs.readFileSync(new URL('../src/engine/builderEngine.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('builderEngine.ts',text,ts.ScriptTarget.Latest,true);
const names=new Set(['localSmoothMax','localSmoothMin','localChamferMin']);
const functions=ast.statements.filter(x=>ts.isFunctionDeclaration(x)&&names.has(x.name.text));
assert.equal(functions.length,3,'All shape helpers must be present in source');
const context=vm.createContext({Math});
vm.runInContext(functions.map(n=>n.getText(ast)).join('\n'),context);
test('Classic union of perpendicular slab planes remains unchanged when radius is zero',()=>{
 for(const [a,b] of [[-.2,.1],[.3,-.25],[.2,.1],[-.25,-.25]]){
  assert.equal(context.localSmoothMax(a,b,0),Math.max(a,b));
  assert.equal(context.localSmoothMin(a,b,0),Math.min(a,b));
  assert.equal(context.localChamferMin(a,b,0),Math.min(a,b));
 }
});
test('45-degree join only bridges a bounded height step',()=>{
 const radius=.55;
 assert(context.localChamferMin(.10,.10,radius)<0,'At a step, chamfer fills the concave diagonal');
 assert(context.localChamferMin(.50,.50,radius)>0,'Distant geometry remains outside material');
 assert.equal(context.localChamferMin(-.70,.70,radius),-.70,'Deep solid remains solid and unchanged');
});
test('support opening lip is subtractive, does not fill a Support block, and uses softer solitary geometry',()=>{
 const body=-.15,insideCut=.6,cutEdge=-.15;
 assert(context.localSmoothMax(body,insideCut,.27)>0,'Interior of Support cut is always outside material');
 const classic=Math.max(body,cutEdge);
 const roundedIsolated=context.localSmoothMax(body,cutEdge,.27);
 const roundedRow=context.localSmoothMax(body,cutEdge,.18);
 assert(roundedIsolated>classic,'Fillet removes a little material at a 90-degree opening rim');
 assert(roundedIsolated>roundedRow,'Lone Support cell has a larger corner radius');
 assert.equal(context.localSmoothMax(body,.8,.27),.8,'Far inside the opening stays empty');
});
test('actual geometry enables curved joins and support lips only in Rounded mode',()=>{
 assert.match(text,/if\(rounded && previousRun && previousRun\.top===run\.bottom/);
 assert.match(text,/rounded && Number\.isFinite\(supportDistance\)/);
 assert.match(text,/localSmoothMax\(d,-supportDistance,nearestSupportLipRadius\)/);
 assert.match(text,/rounded \? THREE\.MathUtils\.lerp\(\.24, \.44, strengthT\) : 0/);
});
