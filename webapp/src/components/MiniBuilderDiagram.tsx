import { SCREW_BLOCK } from '../domain/screwBlock';

// The same 8 × 16 footprint and physical block proportions as Digital Builder.
const {width,depth,height}=SCREW_BLOCK.dimensions;
const columns=8,rows=16,plateWidth=columns*width,plateDepth=rows*depth;
const project=(x:number,y:number,z=0)=>`${130+(x-y)*.34},${68+(x+y)*.18-z*.38}`;
const polygon=(points:number[][])=>points.map(([x,y,z=0])=>project(x,y,z)).join(' ');
const blocks=[{x:3,y:7,z:0},{x:4,y:7,z:0},{x:3,y:8,z:0},{x:4,y:8,z:0},{x:3,y:7,z:1},{x:3,y:8,z:1},{x:3,y:7,z:2}].sort((a,b)=>(a.x+a.y)-(b.x+b.y)||a.z-b.z);
export function MiniBuilderDiagram(){
 return <svg className="mini-builder-diagram" viewBox="0 0 260 215" role="img" aria-label="Digital Builder miniature: an 8 by 16 plate with rectangular cells and seven Standard blocks, each 40 by 20 by 18.5 millimeters.">
  <polygon className="mini-plate-edge" points={polygon([[0,plateDepth,0],[plateWidth,plateDepth,0],[plateWidth,plateDepth,-4],[0,plateDepth,-4]])}/>
  <polygon className="mini-plate-edge" points={polygon([[plateWidth,0,0],[plateWidth,plateDepth,0],[plateWidth,plateDepth,-4],[plateWidth,0,-4]])}/>
  <polygon className="mini-plate-top" points={polygon([[0,0],[plateWidth,0],[plateWidth,plateDepth],[0,plateDepth]])}/>
  <g className="mini-plate-grid">
   {Array.from({length:columns+1},(_,x)=><polyline key={`x${x}`} points={polygon([[x*width,0],[x*width,plateDepth]])}/>)}
   {Array.from({length:rows+1},(_,y)=><polyline key={`y${y}`} points={polygon([[0,y*depth],[plateWidth,y*depth]])}/>)}
  </g>
  {blocks.map(b=>{const x=b.x*width,y=b.y*depth,z=b.z*height,top=z+height;return <g key={`${b.x}:${b.y}:${b.z}`} className="mini-standard-block" data-dimensions={`${width} ${depth} ${height}`}>
   <polygon fill="#c62b1c" points={polygon([[x,y+depth,z],[x+width,y+depth,z],[x+width,y+depth,top],[x,y+depth,top]])}/>
   <polygon fill="#e23826" points={polygon([[x+width,y,z],[x+width,y+depth,z],[x+width,y+depth,top],[x+width,y,top]])}/>
   <polygon fill="#ff5039" points={polygon([[x,y,top],[x+width,y,top],[x+width,y+depth,top],[x,y+depth,top]])}/>
  </g>})}
 </svg>;
}
