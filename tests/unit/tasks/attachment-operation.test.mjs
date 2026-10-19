import {afterEach,expect,test,vi} from "vitest";
import {importTestModule} from "../../helpers/vitest-module.mjs";
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
test("a repeated attachment attempt retains its operation while a later confirmed upload starts another",async()=>{
  const entries=new Map();vi.stubGlobal("sessionStorage",{getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)});
  const {uploadTaskAttachmentRequest}=await importTestModule("src/features/tasks/model/task-api-client.ts");
  const operations=[];let fail=true;
  const client={requestForm:async(_url,_form,options)=>{operations.push(new Headers(options.headers).get("idempotency-key"));if(fail){fail=false;throw new Error("HTTP response lost");}return {response:Response.json({markdown:"attachment"}),body:{markdown:"attachment"}};}};
  const file=new File(["hello"],"hello.txt",{type:"text/plain"});
  await expect(uploadTaskAttachmentRequest(client,"task-1",file)).rejects.toThrow("HTTP response lost");
  const reloaded = await importTestModule("src/features/tasks/model/task-api-client.ts");
  await reloaded.uploadTaskAttachmentRequest(client,"task-1",file);
  await reloaded.uploadTaskAttachmentRequest(client,"task-1",file);
  expect(operations[0]).toMatch(/^[a-f0-9-]{36}$/);expect(operations[1]).toBe(operations[0]);expect(operations[2]).not.toBe(operations[0]);
});
