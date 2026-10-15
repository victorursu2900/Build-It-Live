/** Fast, conservative preflight checks. Not a slicer or a guarantee of printability. */
export type PrintBlock = { x:number; y:number; z:number; type:string };
export type PrintIssue = { severity:'warning'|'info'|'error'; title:string; detail:string };
export type PrintReport = { status:'ready'|'review'|'invalid'; standardCount:number; supportCount:number; issues:PrintIssue[] };
const pos = (x:number,y:number,z:number) => `${x},${y},${z}`;
export function analyzeBlockPrintability(blocks: PrintBlock[], mode: 'voxel'|'soft1' = 'voxel'):PrintReport {
  const standards = blocks.filter(b=>b.type === 'standard');
  const supports = blocks.filter(b=>b.type === 'support');
  const issues:PrintIssue[] = [];
  if (!standards.length) return {
    status:'invalid', standardCount:0, supportCount:supports.length,
    issues:[{severity:'error',title:'NO PRINTABLE BLOCKS',detail:'Add Standard blocks. Support blocks are excluded from print exports.'}],
  };
  if (supports.length) issues.push({severity:'info', title:'TEMPORARY SUPPORTS',detail:`${supports.length} Support block(s) will not be exported.`});
  const occupied = new Set(standards.map(b=>pos(b.x,b.y,b.z)));
  let overhangs = 0;
  for (const block of standards) if (block.z>0 && !occupied.has(pos(block.x,block.y,block.z-1))) overhangs++;
  if (overhangs) issues.push({severity:'warning',title:'OVERHANGS TO REVIEW',detail:`${overhangs} elevated block(s) have no printable block directly below. Check supports in your slicer.`});
  const seen = new Set<string>();
  let components = 0;
  for (const b of standards) {
    const start = pos(b.x,b.y,b.z);
    if (seen.has(start)) continue;
    components++;
    const queue:[number,number,number][] = [[b.x,b.y,b.z]];
    seen.add(start);
    for (let i=0;i<queue.length;i++) {
      const [x,y,z] = queue[i];
      for (const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const key=pos(x+dx,y+dy,z+dz);
        if (occupied.has(key) && !seen.has(key)) {seen.add(key); queue.push([x+dx,y+dy,z+dz]);}
      }
    }
  }
  if (components>1) issues.push({severity:'warning',title:'SEPARATE PARTS',detail:`Model has ${components} disconnected printable parts. Check their placement on the build plate.`});
  if (mode==='soft1') issues.push({severity:'info',title:'SMOOTH SURFACE',detail:'Check the smoothed mesh in your slicer for thin walls and small details.'});
  if (!issues.length) issues.push({severity:'info',title:'BASIC CHECKS PASSED',detail:'No obvious block-level problems detected. Slice and inspect before printing.'});
  return {status:issues.some(i=>i.severity==='warning')?'review':'ready', standardCount:standards.length,supportCount:supports.length,issues};
}
export function analyzeTriangleGeometry(position: ArrayLike<number>, maxTriangles=250000):PrintReport {
  const issues:PrintIssue[] = [];
  const triangles=Math.floor(position.length/9);
  if (!triangles) return {status:'invalid',standardCount:0,supportCount:0,issues:[{severity:'error',title:'EMPTY MESH',detail:'No triangles in imported model.'}]};
  if (triangles>maxTriangles) return {status:'review',standardCount:0,supportCount:0,issues:[{severity:'warning',title:'LARGE MESH',detail:`${triangles.toLocaleString()} triangles. Run a full mesh repair/check in your slicer.`}]};
  const edges=new Map<string,number>();
  let collapsed=0;
  const point=(index:number)=> [Number(position[index]),Number(position[index+1]),Number(position[index+2])];
  const id=(p:number[])=>p.map(n=>Math.round(n*1000)).join(':');
  for(let t=0;t<triangles;t++) {
    const vertices=[point(t*9),point(t*9+3),point(t*9+6)];
    if(vertices.some(p=>p.some(n=>!Number.isFinite(n)))) {collapsed++;continue;}
    const labels=vertices.map(id);
    if(new Set(labels).size!==3) {collapsed++;continue;}
    for(let i=0;i<3;i++) {
      const a=labels[i], b=labels[(i+1)%3];
      const key=a<b?`${a}|${b}`:`${b}|${a}`;
      edges.set(key,(edges.get(key)||0)+1);
    }
  }
  let openEdges=0,nonmanifold=0;
  for(const count of edges.values()) {if(count===1)openEdges++; else if(count>2)nonmanifold++;}
  if(openEdges||nonmanifold) issues.push({severity:'warning',title:'MESH REPAIR RECOMMENDED',detail:`${openEdges} boundary edge(s), ${nonmanifold} non-manifold edge(s). Check/repair in slicer.`});
  if(collapsed) issues.push({severity:'warning',title:'INVALID TRIANGLES',detail:`${collapsed} degenerate or invalid triangle(s).`});
  if(!issues.length) issues.push({severity:'info',title:'MESH EDGE CHECK PASSED',detail:'Triangles have paired edges; this does not guarantee printability.'});
  return {status:issues.some(i=>i.severity==='warning')?'review':'ready',standardCount:0,supportCount:0,issues};
}
