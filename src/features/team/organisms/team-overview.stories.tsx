import { useCalendarPlanningState } from "../../../../tests/helpers/workweek-calendar-owner";
import { useState, useSyncExternalStore } from "react";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { useProfileSettingsCommands } from "../hooks/use-profile-settings-commands";
import { useOwnProfileSettingsCommands } from "@/features/profile/hooks/use-own-profile-settings-commands";
import type { Profile } from "@/lib/types";
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

function TeamCalendarFixture(props: Omit<Parameters<typeof TeamOverview>[0], "planningState">) {
  const planningState = useCalendarPlanningState(props.apiClient, [profile]);
  return <TeamOverview {...props} planningState={planningState} />;
}
const meta={component:TeamCalendarFixture,title:"Team/Organisms/TeamOverview",parameters:{layout:"padded",nextjs:{appDirectory:true,navigation:{pathname:'/team',query:{}}}},tags:["layer:organism","status:stable"],
  args:{actualProfile:profile,tasks:[],pending:false,canManageTeam:false,onSaveProfileSettings:fn(async()=>{}),apiClient:previewClient(true)},
} satisfies Meta<typeof TeamCalendarFixture>;
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


function TeamEditingFixture({ lost = false, conflict = false }: { lost?: boolean; conflict?: boolean }) {
  const target = { ...profile, id: "target", name: "Bea", platformRole: "founder" as const, orgRole: "Founder" };
  const [counts] = useState(() => ({ writes: 0, reads: 0 }));
  const [owner] = useState(() => createPlanningState({ userId: "preview", initialData: { ...emptyPlanningShellState, profiles: [profile, target] }, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task: {} }),
    readWorkspace: async () => { counts.reads++; return { data: { ...emptyPlanningShellState, profiles: [profile, { ...target, weeklyCapacity: conflict && counts.writes === 1 ? 28 : 30 }] } }; },
    saveTeamProfile: async (profileId, patch) => { counts.writes++; if (conflict && counts.writes === 1) throw Object.assign(new Error("Das Profil wurde zwischenzeitlich geändert."), { status: 409, code: "profile_revision_conflict" }); if (lost) throw new Error("Die Profiländerung ist noch nicht bestätigt."); return { id: profileId, ...patch }; },
    saveOwnProfileSettings: async patch => ({ profile: { ...target, ...patch.profilePatch }, notificationPreferences: [] }),
  } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const [error, setSaveError] = useState("");
  const { saveProfileSettings } = useProfileSettingsCommands({ planningState: owner.planning, setSaveError });
  const { saveOwnProfileSettings } = useOwnProfileSettingsCommands({ planningState: owner.planning, currentProfile: target as Profile, setSaveError });
  return <><p>{error}</p><p>Writes: {counts.writes}; reads: {counts.reads}</p><button onClick={() => { void saveOwnProfileSettings({ profilePatch: { focus: "Eigener Fokus bestätigt" } }); }}>Eigenen Fokus speichern</button><p>Eigener Fokus: {data.profiles.find(person => person.id === target.id)?.focus || "leer"}</p><TeamOverview planningState={owner.planning} actualProfile={null} tasks={[]} pending={false} canManageTeam apiClient={previewClient(false)} onSaveProfileSettings={saveProfileSettings} /></>;
}
export const KeepsUnknownTeamDraftOpenAndChecksWithoutReplay: Story = {
  render: () => <TeamEditingFixture lost />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Bea bearbeiten" }));
    const dialog = within(await canvas.findByRole("dialog", { name: "Bea bearbeiten" }));
    await userEvent.clear(dialog.getByRole("spinbutton", { name: "Kapazität" }));
    await userEvent.type(dialog.getByRole("spinbutton", { name: "Kapazität" }), "30");
    await userEvent.click(dialog.getByRole("button", { name: "Speichern" }));
    await expect(canvas.getByRole("dialog", { name: "Bea bearbeiten" })).toBeVisible();
    await expect(dialog.getByRole("spinbutton", { name: "Kapazität" })).toHaveValue(30);
    await expect(dialog.getByRole("button", { name: "Speichern" })).toBeDisabled();
    await userEvent.click(dialog.getByRole("button", { name: "Serverstand prüfen" }));
    await expect(dialog.getByText("Serverstand geprüft. Die Speicherbestätigung bleibt offen.")).toBeVisible();
    await expect(canvas.getByText("Writes: 1; reads: 1")).toBeVisible();
  },
};
export const KeepsTeamDraftDuringOwnSettingsConfirmation: Story = {
  render: () => <TeamEditingFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Eigenen Fokus speichern" }));
    await expect(canvas.getByText("Eigener Fokus: Eigener Fokus bestätigt")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Bea bearbeiten" }));
    const dialog = within(await canvas.findByRole("dialog", { name: "Bea bearbeiten" }));
    await userEvent.clear(dialog.getByRole("spinbutton", { name: "Kapazität" }));
    await userEvent.type(dialog.getByRole("spinbutton", { name: "Kapazität" }), "30");
    await userEvent.click(dialog.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(canvas.queryByRole("dialog", { name: "Bea bearbeiten" })).not.toBeInTheDocument());
    await expect(canvas.getByText("Eigener Fokus: Eigener Fokus bestätigt")).toBeVisible();
    await expect(canvas.getByText("Writes: 1; reads: 1")).toBeVisible();
  },
};

export const KeepsConflictingTeamDraftUntilConsciousSave: Story = {
  render: () => <TeamEditingFixture conflict />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Bea bearbeiten" }));
    const dialog = within(await canvas.findByRole("dialog", { name: "Bea bearbeiten" }));
    await userEvent.clear(dialog.getByRole("spinbutton", { name: "Kapazität" }));
    await userEvent.type(dialog.getByRole("spinbutton", { name: "Kapazität" }), "30");
    await userEvent.click(dialog.getByRole("button", { name: "Speichern" }));
    await expect(dialog.getByText(/Aktueller Serverstand:.*Kapazität: 28 Stunden/)).toBeVisible();
    await expect(dialog.getByRole("spinbutton", { name: "Kapazität" })).toHaveValue(30);
    await expect(dialog.getByRole("button", { name: "Speichern" })).toBeDisabled();
    await expect(canvas.getByText("Writes: 1; reads: 1")).toBeVisible();
    await userEvent.click(dialog.getByRole("button", { name: "Erneut speichern" }));
    await waitFor(() => expect(canvas.queryByRole("dialog", { name: "Bea bearbeiten" })).not.toBeInTheDocument());
    await expect(canvas.getByText("Writes: 2; reads: 2")).toBeVisible();
  },
};
