// @ts-nocheck
/** One CPU job at a time. Cancellation terminates computation, not just its result. */
export class SmoothWorkerClient{
 worker=null;pending=null;sequence=0;
 cancel(){if(!this.pending)return;const pending=this.pending;this.pending=null;this.worker?.terminate();this.worker=null;pending.reject(new DOMException('Smoothing cancelled','AbortError'));}
 compute(payload){
  this.cancel();
  if(!this.worker){this.worker=new Worker(new URL('./smooth.worker.ts',import.meta.url),{type:'module'});const worker=this.worker;this.worker.onmessage=({data})=>{if(this.worker!==worker)return;if(data.id!==this.pending?.id)return;const pending=this.pending;this.pending=null;if(data.error)pending.reject(new Error(data.error));else pending.resolve(data.result);};this.worker.onerror=event=>{if(this.worker!==worker)return;const pending=this.pending;this.pending=null;this.worker?.terminate();this.worker=null;pending?.reject(new Error(event.message||'Smoothing worker could not start'));};}
  return new Promise((resolve,reject)=>{const id=++this.sequence;this.pending={id,resolve,reject};try{this.worker.postMessage({id,payload});}catch(error){this.pending=null;this.worker.terminate();this.worker=null;reject(error);}});
 }
 dispose(){this.cancel();this.worker?.terminate();this.worker=null;}
}
