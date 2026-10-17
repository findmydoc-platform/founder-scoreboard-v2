import { expect, it } from "vitest";
import { observeGoogleWorkweek, type KnownGoogleWorkweekSeries } from "../../../src/features/team-workweek/server/team-workweek-reconciliation-core";

const source = { id: "7", weekday: 7, startMinute: 60, endMinute: 240 };
const cohorts = [
  ["ordinary-months", "2026-11-01T00:00:00Z", "2026-11-01T03:00:00Z", "RRULE:FREQ=WEEKLY;BYDAY=SU;BYMONTH=1,2,4,5,6,7,8,9,11,12"],
  ["transition-month-ordinary", "2026-10-17T23:00:00Z", "2026-10-18T02:00:00Z", "RRULE:FREQ=MONTHLY;BYMONTH=3,10;BYDAY=SU;BYSETPOS=1,2,3,-2"],
  ["spring", "2027-03-28T00:00:00Z", "2027-03-28T02:00:00Z", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU"],
  ["autumn", "2026-10-24T23:00:00Z", "2026-10-25T03:00:00Z", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"],
];

function physicalSeries(): KnownGoogleWorkweekSeries[] {
  return cohorts.map(([part, start, end, rule], index) => {
    const id = `series-${index}`;
    return { id, calendarId: "primary", googleEventId: `fops${index}`, confirmedEtag: "old-etag", confirmedFounderopsRevision: 1,
      weekday: 7, startMinute: 60, endMinute: 240, projectionPart: part, logicalSources: [source],
      intendedPayload: { id: `fops${index}`, start: { dateTime: start, timeZone: "Europe/Berlin" }, end: { dateTime: end, timeZone: "Europe/Berlin" }, recurrence: [rule],
        extendedProperties: { private: { founderopsWorkweekSeriesId: id, founderopsWorkweekRevision: "1", founderopsWorkweekProjectionPart: part, founderopsWorkweekSources: "7" } } } };
  });
}

it("observes untouched seasonal masters as one unchanged logical Sunday template", async () => {
  const series = physicalSeries();
  const result = await observeGoogleWorkweek({ accessToken: { request: (url, init) => fetch(url, init) }, series, logicalWindows: [source],
    fetchImpl: async (input) => {
      const known = series.find((item) => String(input).includes(`/events/${item.googleEventId}?`))!;
      return Response.json({ ...known.intendedPayload, etag: "new-metadata-etag", status: "confirmed", description: "Owner note" });
    } });
  expect(result.state).toBe("unchanged");
  if (result.state === "unchanged") expect(result.observations).toHaveLength(4);
});

it("accepts a coherent all-cohort clock edit and rejects a partial seasonal deletion", async () => {
  const series=physicalSeries();
  const edited=await observeGoogleWorkweek({accessToken: { request: (url, init) => fetch(url, init) },series,logicalWindows:[source],fetchImpl:async input=>{
    const known=series.find(item=>String(input).includes(`/events/${item.googleEventId}?`))!;
    return Response.json({...known.intendedPayload,status:"confirmed",etag:"edited",end:{...known.intendedPayload!.end,dateTime:new Date(Date.parse(known.intendedPayload!.end.dateTime)+3_600_000).toISOString()}});
  }});
  expect(edited).toMatchObject({state:"changed",windows:[{weekday:7,startMinute:60,endMinute:300}]});
  const partial=await observeGoogleWorkweek({accessToken: { request: (url, init) => fetch(url, init) },series,logicalWindows:[source],fetchImpl:async input=>{
    const known=series.find(item=>String(input).includes(`/events/${item.googleEventId}?`))!;
    return known.projectionPart==="spring"?new Response(null,{status:404}):Response.json({...known.intendedPayload,status:"confirmed",etag:"old-etag"});
  }});
  expect(partial).toMatchObject({state:"conflict",appRestoreSupported:true});
  if(partial.state==="conflict") expect(partial.observations).toHaveLength(4);
  const allDeleted=await observeGoogleWorkweek({accessToken: { request: (url, init) => fetch(url, init) },series,logicalWindows:[source],fetchImpl:async()=>new Response(null,{status:410})});
  expect(allDeleted).toMatchObject({state:"changed",windows:[]});
});

it("retains grouped spring logical sources and intentionally unprojected source windows", async () => {
  const first={id:"1",weekday:7,startMinute:120,endMinute:150},second={id:"2",weekday:7,startMinute:180,endMinute:210};
  const missing={id:"3",weekday:1,startMinute:540,endMinute:1020};
  const template=physicalSeries()[2];
  const grouped={...template,logicalSources:[first,second],intendedPayload:{...template.intendedPayload!,start:{dateTime:"2027-03-28T01:00:00Z",timeZone:"Europe/Berlin" as const},end:{dateTime:"2027-03-28T01:30:00Z",timeZone:"Europe/Berlin" as const},extendedProperties:{private:{...template.intendedPayload!.extendedProperties.private,founderopsWorkweekSources:"1,2"}}}};
  const result=await observeGoogleWorkweek({accessToken: { request: (url, init) => fetch(url, init) },series:[grouped],logicalWindows:[first,second,missing],fetchImpl:async()=>Response.json({...grouped.intendedPayload,status:"confirmed",etag:"metadata-etag"})});
  expect(result.state).toBe("unchanged");
});

it("keeps an untouched bounded legacy Sunday series compatible with its stored physical duration",async()=>{
  const template=physicalSeries()[2];
  const legacy={...template,projectionPart:"legacy",intendedPayload:{...template.intendedPayload!,end:{dateTime:"2027-03-28T03:00:00Z",timeZone:"Europe/Berlin" as const},recurrence:["RRULE:FREQ=WEEKLY;COUNT=2"]}};
  expect((await observeGoogleWorkweek({accessToken: { request: (url, init) => fetch(url, init) },series:[legacy],logicalWindows:[source],fetchImpl:async()=>Response.json({...legacy.intendedPayload,status:"confirmed",etag:"metadata"})})).state).toBe("unchanged");
});

it("does not offer an App restoration for an unsupported changed recurrence shape",async()=>{
  const series=physicalSeries();
  const result=await observeGoogleWorkweek({accessToken: { request: (url, init) => fetch(url, init) },series,logicalWindows:[source],fetchImpl:async input=>{
    const known=series.find(item=>String(input).includes(`/events/${item.googleEventId}?`))!;
    return Response.json({...known.intendedPayload,status:"confirmed",etag:"changed",...(known.projectionPart==="spring"?{recurrence:["RRULE:FREQ=DAILY"]}:{})});
  }});
  expect(result).toMatchObject({state:"conflict",appRestoreSupported:false});
});

it("verifies a compensated physical cutoff without importing it and rejects a foreign extension",async()=>{
  const template=physicalSeries()[0];
  const bounded={...template,intendedPayload:{...template.intendedPayload!,recurrence:[`${template.intendedPayload!.recurrence![0]};UNTIL=20261101T000000Z`]}};
  const observe=(extend:boolean)=>observeGoogleWorkweek({accessToken: { request: (url, init) => fetch(url, init) },series:[bounded],logicalWindows:[source],verifyKnownPayloads:true,fetchImpl:async()=>Response.json({...bounded.intendedPayload,status:"confirmed",etag:"observed",...(extend?{recurrence:template.intendedPayload!.recurrence}:{})})});
  expect((await observe(false)).state).toBe("unchanged");
  expect(await observe(true)).toMatchObject({state:"conflict",appRestoreSupported:false});
});
