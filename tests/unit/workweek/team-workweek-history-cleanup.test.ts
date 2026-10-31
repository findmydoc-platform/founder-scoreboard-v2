import { calendarProvider, observedJournal } from "../../helpers/calendar-provider";
import { expect, it } from "vitest";
import { cleanupGoogleWorkweekEffect, type PreparedWorkweekEffect } from "../../../src/features/team-workweek/server/team-workweek-immediate-effects";

const payload = {id:"fopshistory01",start:{dateTime:"2026-10-12T08:00:00Z",timeZone:"Europe/Berlin" as const},end:{dateTime:"2026-10-12T16:00:00Z",timeZone:"Europe/Berlin" as const},recurrence:["RRULE:FREQ=WEEKLY"],extendedProperties:{private:{founderopsWorkweekEffectId:"effect"}}};
const bounded = {...payload,recurrence:["RRULE:FREQ=WEEKLY;UNTIL=20261014T120000Z"]};
const effect = {id:"effect",calendarId:"primary",googleEventId:payload.id,generation:1,payload,state:"pending",confirmedEtag:null,cleanupPayload:bounded,cleanupAt:"2026-10-14T12:00:01Z",cleanupDisposition:"preserve"} as PreparedWorkweekEffect;

it("preserves elapsed provisional occurrences and recovers the same cutoff after a lost PUT response", async()=>{
  let event={...payload,etag:"before"};
  const mutations:string[]=[];
  const fetchImpl=async(_url:unknown,init:RequestInit={})=>{
    if(init.method){mutations.push(init.method);event={...JSON.parse(init.body as string),etag:"after"};throw new Error("lost response");}
    return Response.json(event);
  };
  const result=await cleanupGoogleWorkweekEffect({writeJournal: observedJournal,accessToken: calendarProvider(fetchImpl as typeof fetch),effect,fetchImpl:fetchImpl as typeof fetch});
  expect(result.state).toBe("confirmed");
  expect(mutations).toEqual(["PUT"]);
  expect(event.recurrence).toEqual(bounded.recurrence);
  await cleanupGoogleWorkweekEffect({writeJournal: observedJournal,accessToken: calendarProvider(fetchImpl as typeof fetch),effect,fetchImpl:fetchImpl as typeof fetch});
  expect(mutations).toEqual(["PUT"]);
});

it("does not restore a predecessor over an elapsed provisional segment", async()=>{
  const cutoff={...payload,recurrence:["RRULE:FREQ=WEEKLY;UNTIL=20261012T075959Z"]};
  const retained={...effect,operation:"update" as const,payload:cutoff,expectedPayload:payload,expectedEtag:"before",cleanupPayload:cutoff,cleanupDisposition:"retain" as const};
  const writes:string[]=[];
  expect((await cleanupGoogleWorkweekEffect({writeJournal: observedJournal,accessToken: calendarProvider(),effect:retained,fetchImpl:async(_url,init={})=>{if(init.method)writes.push(init.method);return Response.json({...cutoff,etag:"cutoff"});}})).state).toBe("confirmed");
  expect(writes).toEqual([]);
  expect(await cleanupGoogleWorkweekEffect({writeJournal: observedJournal,accessToken: calendarProvider(),effect:retained,fetchImpl:async()=>Response.json({...payload,etag:"externally-restored"})})).toEqual({state:"delayed",errorClass:"provider_identity_mismatch"});
});

it("does not apply an unfinished disconnect cutoff after its deadline, but recovers its already-applied payload",async()=>{
  let writes=0;
  const plan={...effect,cleanupDeadline:"2026-10-14T12:00:01Z"};
  const now=()=>new Date("2026-10-19T12:00:00Z");
  const fetchImpl:typeof fetch=async(_url,init={})=>{if(init.method)writes++;return Response.json({...payload,etag:"before"});};
  expect(await cleanupGoogleWorkweekEffect({writeJournal: observedJournal,accessToken: calendarProvider(fetchImpl as typeof fetch),effect:plan,now,fetchImpl})).toEqual({state:"delayed",errorClass:"provider_identity_mismatch"});
  expect(writes).toBe(0);
  expect((await cleanupGoogleWorkweekEffect({writeJournal: observedJournal,accessToken: calendarProvider(fetchImpl as typeof fetch),effect:plan,now,fetchImpl:async()=>Response.json({...bounded,etag:"after"})})).state).toBe("confirmed");
});
