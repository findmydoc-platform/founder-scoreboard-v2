import { expect, it } from "vitest";
import { cleanupGoogleWorkweekEffect, recoverGoogleWorkweekWrite, type PreparedWorkweekEffect } from "../../../src/features/team-workweek/server/team-workweek-immediate-effects";

const payload = {
  id: "fopsrecovery", start: {dateTime:"2099-01-12T09:00:00Z",timeZone:"Europe/Berlin" as const},
  end: {dateTime:"2099-01-12T17:00:00Z",timeZone:"Europe/Berlin" as const},
  extendedProperties:{private:{founderopsWorkweekEffectId:"effect"}},
};
const effect:PreparedWorkweekEffect={id:"effect",googleEventId:payload.id,calendarId:"primary",generation:1,operation:"create",payload,state:"pending",confirmedEtag:null};

it("recovers a lost create using the original ID and a duplicate arriving later cannot overwrite it",async()=>{
  let event:Record<string,unknown>|null=null;
  const writes:string[]=[];
  const fetchImpl:typeof fetch=async(_url,init)=>{
    if(init?.method==="POST"){
      writes.push(JSON.parse(String(init.body)).id);
      if(event)return new Response(null,{status:409});
      event={...JSON.parse(String(init.body)),etag:"created"};
      return Response.json(event);
    }
    return event?Response.json(event):new Response(null,{status:404});
  };
  const journal:string[]=[];
  const result=await recoverGoogleWorkweekWrite({accessToken:"test",effect,purpose:"publish",fetchImpl,
    writeJournal:{beforeWrite:async()=>{journal.push("dispatch");},outcome:async state=>{journal.push(state);}}});
  expect(result.state).toBe("confirmed");
  expect(writes).toEqual([payload.id]);
  expect((await fetchImpl("",{method:"POST",body:JSON.stringify(payload)})).status).toBe(409);
  expect(event).toMatchObject({...payload,etag:"created"});
  expect(journal.at(-1)).toBe("settled");
});

it("reserves an expired absent create as cancelled without adding elapsed working hours",async()=>{
  let event:Record<string,unknown>|null=null;
  const fetchImpl:typeof fetch=async(_url,init)=>{
    if(init?.method==="POST"){
      if(event)return new Response(null,{status:409});
      const body=JSON.parse(String(init.body));
      expect(body.status).toBe("cancelled");
      event={id:body.id,status:"cancelled",etag:"tombstone"};
      return Response.json(event);
    }
    return event?Response.json(event):new Response(null,{status:404});
  };
  const journal={beforeWrite:async()=>{},outcome:async()=>{}};
  const recovered=await recoverGoogleWorkweekWrite({accessToken:"test",effect,purpose:"publish",abandon:true,fetchImpl,writeJournal:journal});
  expect(recovered.state).toBe("confirmed");
  const cleaned=await cleanupGoogleWorkweekEffect({accessToken:"test",effect:{...effect,cleanupDisposition:"delete"},fetchImpl,writeJournal:journal});
  expect(cleaned).toMatchObject({state:"confirmed",preserved:false});
  expect((await fetchImpl("",{method:"POST",body:JSON.stringify(payload)})).status).toBe(409);
  expect(event).toEqual({id:payload.id,status:"cancelled",etag:"tombstone"});
});

it("fences a lost conditional update by rotating the baseline ETag before cleanup",async()=>{
  const baseline={...payload,summary:"Original"};
  const replacement={...payload,summary:"Replacement"};
  let event={...baseline,etag:"before"};
  const fetchImpl:typeof fetch=async(_url,init)=>{
    if(init?.method==="PUT"){
      if(new Headers(init.headers).get("if-match")!==event.etag)return new Response(null,{status:412});
      event={...JSON.parse(String(init.body)),etag:"fenced"};
    }
    return Response.json(event);
  };
  const result=await recoverGoogleWorkweekWrite({accessToken:"test",effect:{...effect,operation:"update",payload:replacement,expectedPayload:baseline,expectedEtag:"before"},purpose:"publish",abandon:true,fetchImpl,writeJournal:{beforeWrite:async()=>{},outcome:async()=>{}}});
  expect(result.state).toBe("confirmed");
  expect((await fetchImpl("",{method:"PUT",headers:{"if-match":"before"},body:JSON.stringify(replacement)})).status).toBe(412);
  expect(event).toEqual({...baseline,extendedProperties:{private:{...baseline.extendedProperties.private,founderopsWorkweekRecoveryFence:effect.id}},etag:"fenced"});
  // A crash after the baseline PUT must also be recoverable on the next request.
  expect((await recoverGoogleWorkweekWrite({accessToken:"test",effect:{...effect,operation:"update",payload:replacement,expectedPayload:baseline,expectedEtag:"before"},purpose:"publish",abandon:true,fetchImpl,writeJournal:{beforeWrite:async()=>{throw new Error("must not replay a fenced write");},outcome:async()=>{}}})).state).toBe("confirmed");
});
