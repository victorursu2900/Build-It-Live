// @ts-nocheck
import {buildSmoothPayload} from 'virtual:bil-smoothing-kernel';
self.onmessage=({data})=>{
 try{const result=buildSmoothPayload(data.payload);self.postMessage({id:data.id,result},[result.position.buffer,result.normal.buffer,result.color.buffer,result.triangleColorIndices.buffer]);}
 catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
};
