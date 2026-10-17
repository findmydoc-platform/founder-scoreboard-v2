import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(()=>vi.unstubAllGlobals());
test("an uncertain attachment write observes its durable content target before another write",async()=>{
  const {uploadGitHubAttachment}=await importTestModule("src/lib/github.ts");
  const requests=[]; let created=false;
  vi.stubGlobal("fetch",async(url,options)=>{
    requests.push(options.method);
    if(options.method==="GET") return created ? Response.json({sha:"b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0",download_url:"https://raw.githubusercontent.com/findmydoc-platform/management/main/file.txt"}) : Response.json({message:"Not found"},{status:404});
    created=true;throw new Error("lost success response");
  });
  const first=await uploadGitHubAttachment(".fmd-attachments/tasks/task-1/stable-file.txt",Buffer.from("hello"),"synthetic-user");
  const repeated=await uploadGitHubAttachment(".fmd-attachments/tasks/task-1/stable-file.txt",Buffer.from("hello"),"synthetic-user");
  expect(first).toEqual(repeated);
  expect(requests).toEqual(["GET","PUT","GET","GET"]);
});
