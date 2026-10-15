import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import postcss from 'postcss';
const src=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src');
const files=['style.css','brickmaker.css','studio.css','hardware-studio.css','tutorial.css','hardware-guide.css','controls-v35.css','guide-interactive.css','glass-select-v43.css','hardware-only.css','hardware-builder.css','library-ux-v85.css','preflight-v86.css','menus-v89.css','radius-consistency.css','workflow-refinements.css','studio-tools.css','components/precisionGuide.css','components/digitalWalkthroughVisual.css','components/studioToolsGuide.css','theme-parity-v143.css'];
const colorProperty=/^(?:background(?:-color|-image)?|color|border(?:-(?:top|right|bottom|left))?(?:-color)?|fill|stroke|outline(?:-color)?|box-shadow|text-shadow|caret-color|scrollbar-color|accent-color)$/i;
const colors=/#[0-9a-f]{3,8}\b|(?<![-\w])rgba?\([^)]*\)|(?<![-\w])(?:white|black)\b/ig;
function convert(value,property){return value.replace(colors,original=>{
 let rgb,alpha=1;
 if(original[0]==='#'){let h=original.slice(1);if(h.length===3||h.length===4)h=[...h].map(c=>c+c).join('');rgb=[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));if(h.length===8)alpha=parseInt(h.slice(6),16)/255;}
 else if(/^rgba?/i.test(original)){const values=original.match(/[\d.]+/g).map(Number);rgb=values.slice(0,3);alpha=values[3]??1;}
 else rgb=original.toLowerCase()==='white'?[255,255,255]:[0,0,0];
 const maximum=Math.max(...rgb)/255,minimum=Math.min(...rgb)/255;
 if(maximum-minimum>.145||property.includes('shadow'))return original;
 let dark;
 if(['color','fill','stroke','caret-color'].includes(property)){if(maximum>.87)return original;dark=maximum<.22?[239,237,231]:maximum<.83?[183,182,181]:[222,221,216];}
 else if(property.includes('border')||property.includes('outline'))dark=alpha<1?[223,222,216]:[67,68,73];
 else dark=alpha<1?(maximum>.5?[38,39,44]:[237,235,229]):maximum>.9?[29,30,34]:maximum>.73?[38,39,44]:[47,48,53];
 return `rgba(${dark.join(',')},${alpha})`;
 }).replace(/var\(--ink\)/g,property.startsWith('background')?'var(--night-ink-fill)':'var(--ink)').replace(/var\(--paper(?:-2)?\)/g,property==='color'?'#efede7':'$&');}
function scope(selector){if(selector.startsWith(':root'))return 'html[data-theme="dark"]'+selector.slice(5);if(selector.startsWith('html'))return 'html[data-theme="dark"]'+selector.slice(4);return 'html[data-theme="dark"] '+selector;}
const output=postcss.root();
function walk(source,target){for(const node of source.nodes||[]){if(node.type==='atrule'&&['media','supports','container'].includes(node.name)){const clone=node.clone({nodes:[]});walk(node,clone);if(clone.nodes.length)target.append(clone);}
 else if(node.type==='rule'){const declarations=node.nodes.filter(d=>d.type==='decl'&&(colorProperty.test(d.prop)||(d.prop.startsWith('--')&&/#[0-9a-f]|rgba?\(/i.test(d.value))));if(!declarations.length)continue;const rule=postcss.rule({selector:postcss.list.comma(node.selector).map(scope).join(', ')});for(const declaration of declarations)rule.append(declaration.clone({value:convert(declaration.value,declaration.prop.startsWith('--')?(/text|ink|muted|copy/i.test(declaration.prop)?'color':/line|edge|border|stroke/i.test(declaration.prop)?'border-color':'background'):declaration.prop)}));target.append(rule);}}
}
for(const file of files){output.append(postcss.comment({text:file}));walk(postcss.parse(fs.readFileSync(path.join(src,file),'utf8')),output);}
fs.writeFileSync(path.join(src,'night-neutral-generated.css'),'/* Generated color-only counterparts. Alpha, blur, layout and divider dimensions are preserved. */\n'+output.toString());
console.log('Dark palette regenerated from shared light styles.');
