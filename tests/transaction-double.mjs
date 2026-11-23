import assert from "node:assert/strict";
// A serialized, in-memory transaction double tests the application's compare-and-swap
// against stale revisions, failure paths and concurrent writers without a real browser.
export function transactionDatabase() {
  const data=new Map();
  let tail=Promise.resolve(),abortWrite=false, initialized=false;
  const db={
    createObjectStore(){},
    transaction(name,mode){
      assert.equal(name,"vault");
      const tx={};
      let changes, resolveEnd;
      const done=new Promise(resolve=>{resolveEnd=resolve;});
      const start=tail;
      tail=done;
      const store={
        get(key){
          const request={};
          start.then(()=>setImmediate(()=>{
            request.result=structuredClone(data.get(key));
            request.onsuccess?.();
            if(abortWrite && mode==="readwrite"){
              abortWrite=false;
              tx.error=new Error("fixture storage quota");
              tx.onabort?.();
            } else{
              if (changes) data.set(changes[0],structuredClone(changes[1]));
              tx.oncomplete?.();
            }
            resolveEnd();
          }));
          return request;
        },
        put(value,key){assert.equal(mode,"readwrite"); changes=[key,value];}
      };
      tx.objectStore=(s)=>{assert.equal(s,name); return store;};
      return tx;
    }
  };
  return {snapshot:()=>JSON.stringify([...data]),abortNext:()=>{abortWrite=true;},open(name,version){
    assert.equal(name,"grok-brain-memory-v1"); assert.equal(version,1);
    const req={result:db}; setImmediate(()=>{if(!initialized){initialized=true;req.onupgradeneeded?.();}req.onsuccess?.()}); return req;
  }};
}
