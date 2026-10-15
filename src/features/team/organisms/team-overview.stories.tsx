import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { addCalendarDays, berlinCivilInstant, type CalendarTeamWorkweek } from "@/features/team-workweek/model/team-workweek-calendar";
import { emptyTeamWorkweekWindows, flattenTeamWorkweekWindows } from "@/features/team-workweek/model/team-workweek-draft";
import { workweekStart } from "@/features/team-workweek/model/team-workweek-week";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { TeamOverview } from "./team-overview";

const profile = {id:"preview-owner",name:"Alex",platformRole:"ceo" as const,orgRole:"CEO",githubLogin:"preview-owner",weeklyCapacity:16,color:"#2563eb"};
const nextWeek = addCalendarDays(workweekStart(),7);
const planned:CalendarTeamWorkweek = {
  id:"11111111-1111-4111-8111-111111111111",ownerProfileId:profile.id,effectiveFrom:nextWeek,effectiveAt:new Date(berlinCivilInstant(nextWeek,"00:00")).toISOString(),effectiveTo:null,
  timezone:"Europe/Berlin",publicationRevision:1,lastSyncAt:new Date().toISOString(),
  windows:{...emptyTeamWorkweekWindows(),monday:[{start:"09:00",end:"16:00"}],friday:[{start:"09:00",end:"16:00"}]},
};

function previewClient(hasPlan:boolean):BrowserApiClient {
  return {requestJson:async(input,init)=>{
    const url=new URL(String(input),"http://localhost");
    const response=(body:unknown)=>({response:new Response(null,{status:200}),body});
    if(init?.method==='POST')return {response:new Response(null,{status:503}),body:{error:"Diese Vorschau speichert keine Daten."}};
    if(url.pathname==='/api/team-workweek/team')return response({referenceDate:workweekStart(),
      currentWorkweeks:[],calendarWorkweeks:hasPlan && String(url.searchParams.get('to'))>=nextWeek?[planned]:[],
      upcomingWorkweeks:hasPlan?[planned]:[],publishedOwnerIds:hasPlan?[profile.id]:[],workweeks:hasPlan?[planned]:[],
    });
    if(url.pathname==='/api/team-workweek/private-draft'){
      const week=url.searchParams.get('week')||workweekStart();
      const base=hasPlan && week>=nextWeek?planned:null;
      const publication=hasPlan?{...planned,status:'published',syncState:'confirmed',googleReconciliationState:'confirmed'}:null;
      return response({version:null,publication:null,latestPublished:publication,preparedSuccessor:publication,immediateAllowed:true,minimumEffectiveFrom:nextWeek,
        weekContext:{weekStart:week,contextToken:'a'.repeat(32),basePublicationId:base?.id||null,basePublicationRevision:base?.publicationRevision||null,
          windows:base?flattenTeamWorkweekWindows(base.windows):[],effectiveUntil:hasPlan && !base?planned.effectiveAt:null},
        editBase:null,
      });
    }
    if(url.pathname==='/api/team-workweek/conflict')return response({conflict:null});
    if(url.pathname==='/api/google-workspace/status')return response({connection:{state:'connected',calendarLabel:'team@example.test',connectedAt:null,refreshedAt:null,lastUsedAt:null,accessTokenExpiresAt:null}});
    if(url.pathname==='/api/google-workspace/disconnect')return response({disconnect:{state:'idle',activePublicationCount:0,futureSeriesCount:0,pendingSeriesCount:0,teamVisibilityWillBeDisabled:false}});
    throw Error('Unexpected preview request');
  }} as BrowserApiClient;
}

const meta={component:TeamOverview,title:"Team/Organisms/TeamOverview",parameters:{layout:"padded",nextjs:{appDirectory:true,navigation:{pathname:'/team',query:{}}}},tags:["layer:organism","status:stable"],
  args:{data:{...emptyPlanningShellState,profiles:[profile]},actualProfile:profile,tasks:[],pending:false,canManageTeam:false,onSaveProfileSettings:fn(async()=>{}),apiClient:previewClient(true)},
} satisfies Meta<typeof TeamOverview>;
export default meta;
type Story=StoryObj<typeof meta>;

export const ShowsAConfirmedPlanInItsSelectedWeek:Story={
  play:async({canvasElement})=>{
    const canvas=within(canvasElement);
    await userEvent.click(await canvas.findByRole('button',{name:'Geplante Woche ansehen'}));
    await waitFor(()=>expect(canvas.getAllByText('09:00–16:00').length).toBeGreaterThan(0));
    await expect(canvas.queryByRole('button',{name:'Geplante Woche ansehen'})).not.toBeInTheDocument();
  },
};
export const StartsWithoutPublishedTimes:Story={args:{apiClient:previewClient(false)}};
