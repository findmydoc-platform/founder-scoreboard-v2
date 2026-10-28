import {afterEach,expect,test,vi} from "vitest";
import {importTestModule} from "../../helpers/vitest-module.mjs";
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
test("a repeated attachment attempt retains its operation while a later confirmed upload starts another",async()=>{
  const entries=new Map();vi.stubGlobal("sessionStorage",{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)});
  const {uploadTaskAttachmentRequest}=await importTestModule("src/features/tasks/model/task-api-client.ts");
  const operations=[];let fail=true;
  const client={requestForm:async(_url,_form,options)=>{operations.push(new Headers(options.headers).get("idempotency-key"));if(fail){fail=false;throw new Error("HTTP response lost");}return {response:Response.json({markdown:"attachment"}),body:{markdown:"attachment"}};}};
  const binding={userId:"user",sessionRevision:"session",isCurrent:()=>true};
  const file=new File(["hello"],"hello.txt",{type:"text/plain"});
  await expect(uploadTaskAttachmentRequest(client,"task-1",file,binding)).rejects.toThrow("HTTP response lost");
  const reloaded = await importTestModule("src/features/tasks/model/task-api-client.ts");
  await reloaded.uploadTaskAttachmentRequest(client,"task-1",file,binding);
  await reloaded.uploadTaskAttachmentRequest(client,"task-1",file,binding);
  expect(operations[0]).toMatch(/^[a-f0-9-]{36}$/);expect(operations[1]).toBe(operations[0]);expect(operations[2]).not.toBe(operations[0]);
});

test("retained attachment keys never cross account or session authority",async()=>{
 const entries=new Map();vi.stubGlobal("sessionStorage",{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)});const {uploadTaskAttachmentRequest}=await importTestModule("src/features/tasks/model/task-api-client.ts");const operations=[];const client={requestForm:async(_url,_form,options)=>{operations.push(new Headers(options.headers).get("idempotency-key"));throw new Error("Lost");}};const file=new File(["same"],"same.txt",{type:"text/plain"});
 for(const [userId,sessionRevision]of [["one","session-a"],["two","session-a"],["one","session-b"]])await expect(uploadTaskAttachmentRequest(client,"task",file,{userId,sessionRevision,isCurrent:()=>true})).rejects.toThrow("Lost");expect(new Set(operations).size).toBe(3);
});

test("a session replacement during local hashing stops the multipart write",async()=>{
 const {uploadTaskAttachmentRequest}=await importTestModule("src/features/tasks/model/task-api-client.ts");let current=true,writes=0,finish;const file=new File(["proof"],"proof.txt",{type:"text/plain"});const original=file.arrayBuffer.bind(file);file.arrayBuffer=()=>new Promise(resolve=>{finish=async()=>resolve(await original());});const uploading=uploadTaskAttachmentRequest({requestForm:async()=>{writes++;}},"task",file,{userId:"user",sessionRevision:"session",isCurrent:()=>current});current=false;await finish();await expect(uploading).rejects.toMatchObject({code:"session_superseded"});expect(writes).toBe(0);
});
