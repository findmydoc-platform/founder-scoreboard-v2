import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const provider=await importTestModule("src/features/team-workweek/server/team-workweek-provider-operations.ts",{"server-only":{}});

test.each([false,true])("a journaled uncertain create reaches a usable claim after provider fencing, abandoned=%s",async abandon=>{
  const payload={id:"fopsuncertainclaim",start:{dateTime:"2099-01-12T09:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2099-01-12T17:00:00Z",timeZone:"Europe/Berlin"},extendedProperties:{private:{founderopsWorkweekEffectId:"effect"}}};
  const row={id:"effect",google_event_id:payload.id,generation:1,operation:"create",payload,state:"pending",confirmed_etag:null};
  let settled=false,finished=false,event=null;
  const service={
    from(){return {select(){return this;},eq(){return this;},in:async()=>({data:[{effect_id:row.id,team_workweek_publication_effects:row}],error:null})};},
    async rpc(name,args){
      if(name==="claim_team_workweek_provider_operation")return {data:finished?{state:"claimed",id:"next-operation"}:{state:"uncertain",id:"orphan",purpose:"publish",abandon},error:null};
      if(name==="record_team_workweek_provider_write"){
        assert.equal(args.p_operation_id,"orphan");
        if(args.p_state==="settled")settled=true;
        else assert.equal(args.p_state,"replaying");
        return {data:null,error:null};
      }
      assert.equal(name,"finish_team_workweek_provider_operation");assert.equal(settled,true);finished=true;
      return {data:{state:"settled"},error:null};
    },
  };
  const spy=vi.spyOn(globalThis,"fetch").mockImplementation(async(_url,init)=>{
    if(init?.method==="POST"){
      assert.equal(JSON.parse(String(init.body)).id,payload.id);
      event={...JSON.parse(String(init.body)),etag:"confirmed"};
      return Response.json(event);
    }
    return event?Response.json(event):new Response(null,{status:404});
  });
  try{
    assert.deepEqual(await provider.claimProviderOperation({serviceSupabase:service,publicationId:"publication",generation:1,purpose:abandon?"cleanup":"publish",accessToken: { request: (url, init) => fetch(url, init) }}),{id:"next-operation"});
    assert.equal(event.status,abandon?"cancelled":undefined);
  }finally{spy.mockRestore();}
});
