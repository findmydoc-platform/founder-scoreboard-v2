import { ProductUpdatesProvider } from "@/features/product-updates/organisms/product-updates-provider";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { FeatureTourProvider } from "@/features/product-tours/organisms/feature-tour-provider";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import "driver.js/dist/driver.css";
import { useState } from "react";
import { HeaderCalendarAction } from "@/features/planning/molecules/header-calendar-action";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { workweekStart } from "../model/team-workweek-week";
import { nextMondayIso } from "../model/team-workweek-draft";
import { PrivateTeamWorkweekCard } from "./private-team-workweek-card";
import type { BrowserApiClient } from "@/lib/browser-api-client";

const profile = {
  id: "sebastian",
  name: "Sebastian",
  platformRole: "ceo" as const,
  orgRole: "CEO",
  githubLogin: "sebastian",
  weeklyCapacity: 40,
  color: "#2563eb",
};

const publishedWindows = {
  monday: [{ start: "09:00", end: "17:00" }],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

function response(body: unknown) {
  return { body, response: new Response(null, { status: 200 }) };
}

const latestPublished = {
  id: "publication-1",
  effectiveFrom: "2026-09-07",
  status: "published",
  syncState: "confirmed",
  publicationRevision: 1,
  publishedAt: "2026-09-07T07:00:00.000Z",
  lastSyncAt: "2026-09-07T07:00:00.000Z",
  googleReconciliationState: "confirmed",
  lastGoogleReconciliationAt: "2026-09-07T07:00:00.000Z",
};

type ClientOptions = {
  minimumEffectiveFrom?: string;
  preparedSuccessor?: Record<string, unknown> | null;
  immediateAllowed?: boolean;
  googleConnected?: boolean;
  editBase?: { windows: typeof publishedWindows } | null;
  reconciliation?: Record<string, unknown>;
  reconciliationAfter?: Record<string, unknown>;
  latestPublished?: Record<string, unknown> | null;
  publication?: Record<string, unknown> | null;
  publish?: {
    after: Record<string, unknown>;
    result: Record<string, unknown>;
  };
  failRestartContextOnce?: boolean;
  restartAvailable?: boolean;
  restart?: { after: Record<string, unknown>; result: Record<string, unknown>; status?: number };
  conflict?: Record<string, unknown> | null;
  conflictResolution?: { after: Record<string, unknown>; result: Record<string, unknown> };
  publishConflict?: Record<string, unknown>;
  version?: Record<string, unknown> | null;
  saveError?: string;
  losePublishResponse?: boolean;
};

function client(options: ClientOptions = {}): BrowserApiClient {
  let privateBody = {
    ...(options.restartAvailable !== undefined ? { restartAvailable: options.restartAvailable } : {}),
    preparedSuccessor: options.preparedSuccessor || null,
    ...(options.immediateAllowed !== undefined ? {immediateAllowed:options.immediateAllowed} : {}),
    editBase: options.editBase === undefined ? { windows: publishedWindows } : options.editBase,
    latestPublished: options.latestPublished === undefined ? latestPublished : options.latestPublished,
    minimumEffectiveFrom: options.minimumEffectiveFrom || nextMondayIso(),
    publication: options.publication || null,
    version: options.version || null,
  };
  let failRestartContext = false;
  let activeConflict = options.conflict || null;
  let losePublishResponse = Boolean(options.losePublishResponse);
  return {
    requestJson: async (input: RequestInfo | URL, init?: { method?: string; json?: Record<string, unknown> }) => {
      const path = String(input);
      if (path.includes("feature-tour")) return response({});
      if (path.startsWith("/api/team-workweek/private-draft")) {
        if (init?.method === "POST") {
          if (options.saveError) return { body: { error: options.saveError }, response: new Response(null, { status: 503 }) };
          const version = { id: "private-saved", timezone: "Europe/Berlin", status: "preparing", createdAt: new Date().toISOString(), ...init.json };
          privateBody = { ...privateBody, version };
          return response({ version });
        }
        if (failRestartContext) {
          failRestartContext = false;
          return { body: { error: "Aktueller Stand nicht erreichbar." }, response: new Response(null, { status: 503 }) };
        }
        const requestedWeek = new URL(path,"http://localhost").searchParams.get("week");
        const saved = privateBody.version as {activationMode?:string;effectiveFrom:string;windows?: typeof publishedWindows} | null;
        const weekStart = requestedWeek || (saved?.activationMode === "future_monday" ? saved.effectiveFrom : saved && !saved.activationMode ? saved.effectiveFrom : workweekStart());
        const weekContext = { weekStart, contextToken: "a".repeat(32), basePublicationId: (privateBody.editBase as {basePublicationId?:string}|null)?.basePublicationId || null, basePublicationRevision: (privateBody.editBase as {basePublicationRevision?:number}|null)?.basePublicationRevision || null,
          effectiveUntil: privateBody.preparedSuccessor && String(privateBody.preparedSuccessor.effectiveFrom)>weekStart ? privateBody.preparedSuccessor.effectiveAt || `${privateBody.preparedSuccessor.effectiveFrom}T00:00:00+01:00` : null,
          windows: (privateBody.editBase?.windows.monday || []).map(window=>({weekday:1,startMinute:Number(window.start.slice(0,2))*60+Number(window.start.slice(3)),endMinute:Number(window.end.slice(0,2))*60+Number(window.end.slice(3))})),
        };
        const version = requestedWeek && saved && saved.effectiveFrom !== requestedWeek && !privateBody.publication ? null : privateBody.version;
        return response({...privateBody,version,weekContext});
      }
      if (path.startsWith("/api/team-workweek/team?")) return response({ calendarWorkweeks: [], currentWorkweeks: [], referenceDate: "2026-09-07" });
      if (path === "/api/team-workweek/restart" && options.restart) {
        failRestartContext = Boolean(options.failRestartContextOnce);
        privateBody = options.restart.after as typeof privateBody;
        return { response: new Response(null, { status: options.restart.status || 200 }), body: options.restart.result };
      }
      if (path === "/api/team-workweek/conflict") {
        if (init?.method === "POST" && options.conflictResolution) {
          privateBody = options.conflictResolution.after as typeof privateBody;
          activeConflict = null;
          return response({ publication: options.conflictResolution.result });
        }
        return response({ conflict: activeConflict });
      }
      if (path === "/api/team-workweek/publish" && options.publishConflict) {
        activeConflict = options.publishConflict;
        return { response: new Response(null, { status: 409 }), body: { conflict: { id: activeConflict.id, conflictRevision: activeConflict.conflictRevision } } };
      }
      if (path === "/api/team-workweek/publish" && options.publish) {
        if (losePublishResponse) {
          losePublishResponse = false;
          throw new Error("Antwort der Veröffentlichung konnte nicht geladen werden.");
        }
        privateBody = options.publish.after as typeof privateBody;
        return response({ publication: options.publish.result });
      }
      if (path === "/api/team-workweek/reconcile") {
        if (options.reconciliationAfter) privateBody = options.reconciliationAfter as typeof privateBody;
        return response({ reconciliation: options.reconciliation || { state: "unchanged" } });
      }
      if (path === "/api/google-workspace/status") {
        return response({ connection: { calendarLabel: options.googleConnected ? "team@example.test" : null, state: options.googleConnected ? "connected" : "not_connected", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null } });
      }
      if (path === "/api/google-workspace/disconnect") {
        return response({ disconnect: { state: "idle", activePublicationCount: 0, futureSeriesCount: 0, pendingSeriesCount: 0, teamVisibilityWillBeDisabled: false } });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  } as unknown as BrowserApiClient;
}

const meta = {
  component: PrivateTeamWorkweekCard,
  parameters: { viewport: { defaultViewport: "mobile1" } },
  tags: ["layer:molecule", "status:stable"],
  title: "Team Workweek/Molecules/PrivateTeamWorkweekCard",
} satisfies Meta<typeof PrivateTeamWorkweekCard>;

export default meta;
type Story = StoryObj<typeof meta>;

function selectedWeekClient(): BrowserApiClient {
  const base = client({googleConnected:true,latestPublished:{...latestPublished,effectiveFrom:nextMondayIso()}});
  return {requestJson: async (input,init) => {
    const result = await base.requestJson<Record<string,unknown>>(input,init);
    if (String(input).startsWith("/api/team-workweek/private-draft") && init?.method !== "POST") {
      const week = new URL(String(input),"http://localhost").searchParams.get("week") || workweekStart();
      return {...result,body:{...result.body,weekContext:{weekStart:week,contextToken:"a".repeat(32),basePublicationId:null,basePublicationRevision:null,effectiveUntil:null,
        windows:[{weekday:1,startMinute:week===nextMondayIso()?600:540,endMinute:week===nextMondayIso()?840:1020}]}}};
    }
    return result;
  }} as BrowserApiClient;
}

export const LoadsTheSelectedPlanAndProtectsUnsavedEditsWhenChangingWeeks: Story = {
  args:{profile,apiClient:selectedWeekClient()},
  play:async({canvasElement})=>{
    const canvas=within(canvasElement);
    await userEvent.click(await canvas.findByRole("button",{name:"Arbeitswoche bearbeiten"}));
    await waitFor(()=>expect(canvas.getByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("10:00"));
    const end=canvas.getByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end);await userEvent.type(end,"15:00");
    const picker=canvas.getByRole("combobox",{name:"Arbeitswoche auswählen"});
    await userEvent.selectOptions(picker,workweekStart());
    await expect(canvas.getByRole("alertdialog")).toBeVisible();
    await userEvent.click(canvas.getByRole("button",{name:"Weiter bearbeiten"}));
    await expect(picker).toHaveValue(nextMondayIso());
    await expect(end).toHaveValue("15:00");
    await userEvent.selectOptions(picker,workweekStart());
    await userEvent.click(canvas.getByRole("button",{name:"Änderungen verwerfen"}));
    await waitFor(()=>expect(canvas.getByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("09:00"));
    await expect(picker).toHaveValue(workweekStart());
  },
};

export const PrefillsThePublishedWorkweek: Story = {
  args: { apiClient: client(), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await expect(await canvas.findByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("09:00");
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("17:00");
    await expect(canvas.queryByRole("button", { name: "Mit aktuellem Stand neu beginnen" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("combobox", {name:"Arbeitswoche auswählen"})).toHaveValue(workweekStart());
  },
};

export const ContinuesThePrivateDraft: Story = {
  args: {
    apiClient: client({ version: {
        id: "private-1",
        effectiveFrom: nextMondayIso(),
        timezone: "Europe/Berlin",
        status: "preparing",
        createdAt: "2026-09-07T08:00:00.000Z",
        windows: { ...publishedWindows, monday: [{ start: "08:00", end: "12:00" }] },
      } }),
    profile,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Entwurf gespeichert. Noch nicht im Team sichtbar.")).toBeInTheDocument();
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect(await canvas.findByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("08:00");
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("12:00");
    await expect(canvas.getByRole("combobox", {name:"Arbeitswoche auswählen"})).toHaveValue(nextMondayIso());
  },
};

export const StartsTheFirstWorkweekEmpty: Story = {
  args: { apiClient: client({ editBase: null, latestPublished: null }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche einrichten" }));
    await expect(canvas.getByText("Erst Veröffentlichen trägt diese Zeiten in Google ein. Eigene Google-Termine werden nicht übernommen.")).toBeVisible();
    await expect((await canvas.findAllByText("Kein Arbeitszeitfenster")).length).toBeGreaterThan(0);
    await expect(canvas.queryByLabelText("Montag, Fenster 1, Beginn")).not.toBeInTheDocument();
    await expect(canvas.getByRole("combobox", {name:"Arbeitswoche auswählen"})).toHaveValue(workweekStart());
    await expect(canvas.queryByLabelText("Gültigkeitsbeginn der Arbeitswoche")).not.toBeInTheDocument();
  },
};

export const ShowsDelayedSynchronizationWithoutReplacingTheTeamState: Story = {
  args: {
    apiClient: client({
      publication: {
        ...latestPublished,
        id: "preparing-publication",
        status: "preparing",
        syncState: "delayed",
      },
      version: {
        id: "private-1",
        effectiveFrom: nextMondayIso(),
        timezone: "Europe/Berlin",
        status: "preparing",
        createdAt: "2026-09-07T08:00:00.000Z",
        windows: { ...publishedWindows, monday: [{ start: "08:00", end: "12:00" }] },
      },
    }),
    profile,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect((await canvas.findAllByText("Synchronisierung verzögert")).length).toBeGreaterThan(0);
    await expect(canvas.getByText(/Bisheriger Teamstand sichtbar/)).toBeInTheDocument();
  },
};

export const PublishesOnlyAfterProviderConfirmation: Story = {
  args: {
    apiClient: client({
      publish: {
        after: {
          editBase: { windows: publishedWindows },
          latestPublished: { ...latestPublished, id: "publication-2", effectiveFrom: nextMondayIso(), publicationRevision: 2 },
          minimumEffectiveFrom: "2026-09-28",
          publication: null,
          version: null,
        },
        result: {
          id: "publication-2",
          status: "published",
          syncState: "confirmed",
          publicationRevision: 2,
          publishedAt: "2026-09-07T09:00:00.000Z",
          lastSyncAt: "2026-09-07T09:00:00.000Z",
          recovery: null,
        },
      },
      version: {
        id: "private-2",
        effectiveFrom: nextMondayIso(),
        timezone: "Europe/Berlin",
        status: "preparing",
        createdAt: "2026-09-07T08:00:00.000Z",
        windows: publishedWindows,
      },
    }),
    profile,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const published = fn();
    window.addEventListener("founderops:team-workweek-published", published, { once: true });
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Änderung in Google & Team veröffentlichen" }));
    await expect(published).toHaveBeenCalledOnce();
    await expect(canvas.queryByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" })).not.toBeInTheDocument();
    await expect(canvas.getByText(/Die geplante Woche ist bereits im Kalender sichtbar/)).toBeInTheDocument();
  },
};

export const PublishesAnEditedFormInOneAction: Story = {
  args: { apiClient: client({ publish: {
    after: { editBase: { windows: publishedWindows }, latestPublished: { ...latestPublished, effectiveFrom: nextMondayIso() }, minimumEffectiveFrom: nextMondayIso(), publication: null, version: null },
    result: { ...latestPublished, recovery: null },
  } }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end);
    await userEvent.type(end, "18:00");
    const publish = canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" });
    await expect(publish).toBeEnabled();
    await userEvent.click(publish);
    await expect(await canvas.findByText("Arbeitswoche wurde mit Google synchronisiert und im Team veröffentlicht.")).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" })).not.toBeInTheDocument();
  },
};

function CalendarJourney() {
  const [teamOpen, setTeamOpen] = useState(false);
  const [editorRequested, setEditorRequested] = useState(false);
  const [apiClient] = useState(() => client({ version: { id: "draft-calendar", effectiveFrom: nextMondayIso(), timezone: "Europe/Berlin", status: "preparing", createdAt: "2026-09-07T08:00:00.000Z", windows: { ...publishedWindows, monday: [{ start: "08:00", end: "12:00" }] } }, publish: {
    after: { editBase: { windows: publishedWindows }, latestPublished: { ...latestPublished, effectiveFrom: nextMondayIso() }, minimumEffectiveFrom: nextMondayIso(), publication: null, version: null },
    result: { ...latestPublished, recovery: null },
  } }));
  return <>
    <HeaderCalendarAction apiClient={apiClient} events={{ data: [], state: "ready", error: "" }} profiles={[profile]} onOpenTeam={(editWorkweek) => { setTeamOpen(true); setEditorRequested(Boolean(editWorkweek)); }} />
    {teamOpen && <PrivateTeamWorkweekCard apiClient={apiClient} profile={profile} editorRequested={editorRequested} onEditorRequestHandled={() => setEditorRequested(false)} />}
  </>;
}

export const ContinuesAndPublishesFromTheCalendar: Story = {
  args: { apiClient: client(), profile },
  render: () => <CalendarJourney />,
  parameters: { layout: "fullscreen" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await userEvent.click(await body.findByRole("tab", { name: "Arbeitswoche" }));
    const action = body.getByRole("button", { name: "Meine Arbeitswoche bearbeiten" });
    action.focus();
    await expect(action).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(await canvas.findByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("08:00");
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("12:00");
    await userEvent.click(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" }));
    await expect(await canvas.findByText("Arbeitswoche wurde mit Google synchronisiert und im Team veröffentlicht.")).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole("button", { name: "Arbeitswoche bearbeiten" })).toHaveFocus());
  },
};

export const KeepsInputsWhenPrivateSavingFails: Story = {
  args: { apiClient: client({ saveError: "Speichern vorübergehend nicht möglich." }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end);
    await userEvent.type(end, "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" }));
    await expect(await canvas.findByText(/Speichern vorübergehend nicht möglich/)).toHaveTextContent("die Veröffentlichung wurde nicht gestartet");
    await expect(end).toHaveValue("18:00");
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeEnabled();
  },
};

export const SavesPrivatelyWithoutPublication: Story = {
  args: { apiClient: client(), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end);
    await userEvent.type(end, "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Entwurf speichern" }));
    await expect(await canvas.findByText("Entwurf gespeichert. Noch nicht veröffentlicht.")).toBeVisible();
    await expect(canvas.getByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" })).toBeInTheDocument();
  },
};

export const RetainsTheSavedDraftWhenPublicationIsDelayed: Story = {
  args: { apiClient: client({ publish: {
    after: {}, result: { ...latestPublished, id: "publication-delayed", status: "preparing", syncState: "delayed", recovery: "retry" },
  } }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end);
    await userEvent.type(end, "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" }));
    await expect(await canvas.findByText(/Synchronisierung verzögert\. Google kann bereits vorläufige App-Termine/)).toHaveTextContent("der bisherige Teamstand bleibt sichtbar");
    await expect(end).toHaveValue("18:00");
    await expect(canvas.getByRole("button", { name: "Entwurf speichern" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeEnabled();
  },
};

export const RetriesTheSavedRevisionAfterALostResponse: Story = {
  args: { apiClient: client({ losePublishResponse: true, publish: {
    after: { editBase: { windows: publishedWindows }, latestPublished: { ...latestPublished, effectiveFrom: nextMondayIso() }, minimumEffectiveFrom: nextMondayIso(), publication: null, version: null },
    result: { ...latestPublished, recovery: null },
  } }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end);
    await userEvent.type(end, "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" }));
    await expect(await canvas.findByText(/Antwort der Veröffentlichung/)).toHaveTextContent("Wiederhole die Veröffentlichung, um den Stand zu prüfen");
    await expect(canvas.getByRole("button", { name: "Entwurf speichern" })).toBeDisabled();
    await expect(end).toHaveValue("18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" }));
    await expect(await canvas.findByText("Arbeitswoche wurde mit Google synchronisiert und im Team veröffentlicht.")).toBeInTheDocument();
  },
};

export const ExplainsManagedSeriesBeforeAndAfterCheckingGoogle: Story = {
  args: { apiClient: client({ googleConnected: true }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "App-Termine in Google prüfen" }));
    await expect(await canvas.findByText("Die von FounderOps angelegten Google-Serien sind unverändert. Selbst angelegte Google-Termine wurden nicht übernommen.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await expect(await canvas.findByText("Verbunden")).toBeVisible();
    await expect(canvas.getByText(/Eigene Google-Termine werden nicht übernommen/)).toBeVisible();
  },
};

export const NamesAPreparedFutureScheduleSeparatelyFromAPrivateDraft: Story = {
  args: { apiClient: client({ latestPublished: { ...latestPublished, effectiveFrom: "2099-01-05" } }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/Geplant ab 05. Jan./)).toBeVisible();
    await expect(canvas.getByText(/Die geplante Woche ist bereits im Kalender sichtbar/)).toBeVisible();
    await expect(canvas.queryByText("Privater Entwurf")).not.toBeInTheDocument();
  },
};

export const FirstPublicationUsesOneWeekSelection: Story = {
  args: {profile, apiClient: client({latestPublished:null,editBase:null})},
  play: async ({canvasElement}) => {
    const canvas=within(canvasElement);
    await userEvent.click(await canvas.findByRole("button",{name:"Arbeitswoche einrichten"}));
    const picker = canvas.getByRole("combobox",{name:"Arbeitswoche auswählen"});
    await expect(picker).toHaveValue(workweekStart());
    await expect(canvas.getByText(/Vergangene Zeiten bleiben unverändert/)).toBeVisible();
    await userEvent.selectOptions(picker,nextMondayIso());
    await waitFor(()=>expect(picker).toHaveValue(nextMondayIso()));
    await expect(canvas.getByText("Die Arbeitszeiten wiederholen sich ab dieser Woche.")).toBeVisible();
  },
};

export const PublishesFirstWorkweekWithItsConfirmedInstant: Story = {
  args:{profile,apiClient:client({latestPublished:null,editBase:null,publish:{
    result:{...latestPublished,id:"first-confirmed",activationMode:"immediate",effectiveAt:"2026-10-14T10:03:00Z",status:"published",syncState:"confirmed",recovery:null},
    after:{version:null,publication:null,editBase:{windows:publishedWindows},minimumEffectiveFrom:nextMondayIso(),latestPublished:{...latestPublished,id:"first-confirmed",activationMode:"immediate",effectiveAt:"2026-10-14T10:03:00Z"}},
  }})},
  play:async({canvasElement})=>{
    const canvas=within(canvasElement);
    await userEvent.click(await canvas.findByRole("button",{name:"Arbeitswoche einrichten"}));
    await expect(canvas.getByRole("combobox",{name:"Arbeitswoche auswählen"})).toHaveValue(workweekStart());
    await expect(canvas.queryByText(/Geplante Änderung am .* bleibt erhalten/)).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button",{name:"Mittwoch: Fenster hinzufügen"}));
    await userEvent.click(canvas.getByRole("button",{name:"Änderung in Google & Team veröffentlichen"}));
    await waitFor(()=>expect(canvas.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(canvas.getByText(/Arbeitswoche bestätigt\. Gültig ab 14\.10\.2026, 12:03 MESZ/)).toBeVisible();
    await expect(canvas.getAllByText(/Gültig ab 14\.10\.2026, 12:03 MESZ/).length).toBeGreaterThan(0);
  },
};


export const ReplacesAnActiveScheduleWithAnExplicitConfirmedBoundary: Story = {
  args:{profile,apiClient:client({immediateAllowed:true,latestPublished:{...latestPublished,id:"11111111-1111-4111-8111-111111111111"},publish:{
    result:{...latestPublished,id:"replacement",publicationRevision:2,activationMode:"immediate",effectiveAt:"2026-10-14T12:03:00Z",status:"published",syncState:"confirmed",recovery:null},
    after:{version:null,publication:null,editBase:{windows:publishedWindows},minimumEffectiveFrom:nextMondayIso(),immediateAllowed:true,latestPublished:{...latestPublished,id:"replacement",publicationRevision:2,activationMode:"immediate",effectiveAt:"2026-10-14T12:03:00Z"}},
  }})},
  play:async({canvasElement})=>{
    const canvas=within(canvasElement);
    await userEvent.click(await canvas.findByRole("button",{name:"Arbeitswoche bearbeiten"}));
    await expect(canvas.getByRole("combobox",{name:"Arbeitswoche auswählen"})).toHaveValue(workweekStart());
    await userEvent.click(canvas.getByRole("button",{name:"Mittwoch: Fenster hinzufügen"}));
    await userEvent.click(canvas.getByRole("button",{name:"Änderung in Google & Team veröffentlichen"}));
    await waitFor(()=>expect(canvas.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(canvas.getByText(/Arbeitswoche bestätigt\. Gültig ab 14\.10\.2026, 14:03 MESZ/)).toBeVisible();
  },
};

export const ExplainsOnlyAffectedSundayClockLabels: Story = {
  args: { apiClient: client({ version: {
    id: "seasonal-private", effectiveFrom: nextMondayIso(), timezone: "Europe/Berlin", status: "preparing",
    createdAt: new Date().toISOString(), windows: { ...publishedWindows, sunday: [{ start: "02:15", end: "03:30" }] },
  } }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect(canvas.getByText(/Sonntagszeiten zwischen 02:00 und 03:00/)).toBeInTheDocument();
    await userEvent.clear(canvas.getByLabelText("Sonntag, Fenster 1, Beginn"));
    await userEvent.type(canvas.getByLabelText("Sonntag, Fenster 1, Beginn"), "01:15");
    await expect(canvas.queryByText(/Sonntagszeiten zwischen 02:00 und 03:00/)).not.toBeInTheDocument();
  },
};

export const RetainsThePreparedMondayDuringCurrentCorrections: Story = {
  args: { profile, apiClient: client({ googleConnected: true, immediateAllowed: true, minimumEffectiveFrom: "2026-10-26", preparedSuccessor: {
    ...latestPublished, id: "retained", effectiveFrom: "2026-10-19", effectiveAt: "2026-10-18T22:00:00Z",
  } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await expect(canvas.getByText(/spätere Planungen bleiben erhalten/)).toBeVisible();
    await expect(canvas.queryByText(/Gilt dauerhaft\./)).not.toBeInTheDocument();
    await userEvent.selectOptions(canvas.getByRole("combobox",{name:"Arbeitswoche auswählen"}),nextMondayIso());
    await expect(canvas.queryByText(/spätere Planungen bleiben erhalten/)).not.toBeInTheDocument();
  },
};

export const ConfirmsTheActualStartAndRetainedNextChange: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true, preparedSuccessor: { ...latestPublished, id: "retained", effectiveFrom: "2026-10-19" }, publish: {
    result: { ...latestPublished, id: "correction", publicationRevision: 3, status: "published", syncState: "confirmed", recovery: null,
      activationMode: "immediate", effectiveAt: "2026-10-14T12:03:00Z", effectiveUntil: "2026-10-18T22:00:00Z" },
    after: { version: null, publication: null, latestPublished: { ...latestPublished, id: "correction", publicationRevision: 3, activationMode: "immediate", effectiveAt: "2026-10-14T12:03:00Z", effectiveUntil: "2026-10-18T22:00:00Z", lastSyncAt: "2026-10-14T12:00:00Z" }, immediateAllowed: true, minimumEffectiveFrom: "2026-10-26", editBase: { windows: publishedWindows } },
  } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await userEvent.click(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" }));
    await waitFor(() => expect(canvas.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(canvas.getByText(/Gültig ab 14\.10\.2026, 14:03 MESZ.*Die geplante Änderung am 19\.10\.2026 bleibt erhalten/)).toBeVisible();
  },
};


export const ExplainsUnsupportedGoogleVariantWithoutInventingAnEmptyPlan: Story = {
  args: { profile, apiClient: client({ conflict: {
    id: "conflict-seasonal", conflictRevision: 1, state: "open", decision: null, observedAt: "2026-10-14T12:00:00Z",
    founderops: { effectiveFrom: nextMondayIso(), activationMode: "immediate", windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] },
    google: { effectiveFrom: nextMondayIso(), supported: false, windows: [] },
  } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Google übernehmen" })).toBeDisabled();
    await expect(canvas.getByText("Diese Google-Änderung lässt sich keiner eindeutigen Grundwoche zuordnen.")).toBeVisible();
    await expect(canvas.queryByText("Keine Arbeitszeitfenster")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "FounderOps übernehmen" })).toBeEnabled();
    await expect(canvas.getByText("Beginn wird nach Bestätigung festgelegt")).toBeVisible();
    await expect(canvas.getAllByText(/^Gültig ab/).every(element => Boolean(element.closest("details")))).toBe(true);
    await expect(canvas.getByText("Letzter bestätigter Teamstand bleibt sichtbar.")).toBeVisible();
    await expect(canvas.queryByText(/Bestätigt in Team und Google/)).not.toBeInTheDocument();
  },
};


export const ExposesVariantsAfterAnAutosavedPublicationConflict: Story = {
  args: { profile, apiClient: client({ publishConflict: {
    id: "parallel-conflict", conflictRevision: 1, state: "open", decision: null, observedAt: "2026-10-14T12:00:00Z",
    founderops: { effectiveFrom: nextMondayIso(), windows: [{ weekday: 1, startMinute: 540, endMinute: 1080 }] },
    google: { effectiveFrom: nextMondayIso(), windows: [{ weekday: 1, startMinute: 480, endMinute: 960 }] },
  } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end);
    await userEvent.type(end, "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" }));
    await waitFor(() => expect(canvas.queryByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" })).not.toBeInTheDocument());
    await expect(canvas.getByText("Montag: 09:00–18:00")).toBeVisible();
    await expect(canvas.getByText("Montag: 08:00–16:00")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "FounderOps übernehmen" })).toBeEnabled();
    await waitFor(() => expect(canvas.getByRole("button", { name: "Bearbeitung fortsetzen" })).toHaveFocus());
  },
};


const expiredDraft = {
  id: "expired-private", effectiveFrom: nextMondayIso(), activationMode: "immediate", timezone: "Europe/Berlin",
  status: "preparing", createdAt: "2026-10-14T12:00:00Z", windows: publishedWindows,
};
const restartedDraft = { ...expiredDraft, id: "fresh-private", basePublicationId: "22222222-2222-4222-8222-222222222222", basePublicationRevision: 4 };
const restartedMondayDraft = { ...expiredDraft, id: "fresh-monday-private", activationMode: "future_monday" };
const restartedContext = {
  version: restartedDraft, publication: null, immediateAllowed: true, restartAvailable: false,
  minimumEffectiveFrom: "2099-01-19", editBase: { windows: publishedWindows },
  latestPublished: { ...latestPublished, id: "22222222-2222-4222-8222-222222222222", publicationRevision: 4 },
  preparedSuccessor: { ...latestPublished, id: "successor-new", effectiveFrom: "2099-01-12", effectiveAt: "2099-01-11T23:00:00Z" },
};

export const RestartsWithCurrentContextAndRetainsUnsavedWindows: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true, restartAvailable: true, version: expiredDraft,
    publication: { ...latestPublished, id: "expired-operation", status: "preparing", syncState: "delayed", effectiveAt: "2026-10-14T12:03:00Z" },
    restart: { after: restartedContext, result: { version: restartedDraft, restart: { state: "ready", recovery: null } } },
  }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    const end = await canvas.findByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end);
    await userEvent.type(end, "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Neustart vorbereitet/)).toBeVisible();
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await expect(canvas.getByText(/spätere Planungen bleiben erhalten/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Entwurf speichern" })).toBeEnabled();
    await expect(canvas.queryByRole("button", { name: "Mit aktuellem Stand neu beginnen" })).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toHaveFocus());
    await expect(canvas.getByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" })).toBeVisible();
    await expect(canvas.queryByText(/Arbeitswoche bestätigt/)).not.toBeInTheDocument();
  },
};

export const RestartsADelayedMondayWithoutLosingCurrentWeekEdits: Story = {
  args: { profile, apiClient: client({
    googleConnected: true, immediateAllowed: true, restartAvailable: true,
    latestPublished: null, editBase: null,
    version: { ...expiredDraft, id: "delayed-monday-private", effectiveFrom: nextMondayIso(), activationMode: "future_monday" },
    publication: { ...latestPublished, id: "delayed-monday-operation", status: "preparing", syncState: "delayed", activationMode: "future_monday", effectiveAt: "2099-01-11T23:00:00Z" },
    restart: { after: { ...restartedContext, version: restartedMondayDraft, latestPublished: null, preparedSuccessor: null, editBase: null, minimumEffectiveFrom: nextMondayIso() }, result: { version: restartedMondayDraft, restart: { state: "ready", recovery: null } } },
  }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toBeDisabled();
    const end = canvas.getByLabelText("Montag, Fenster 1, Ende");
    await userEvent.clear(end);
    await userEvent.type(end, "18:00");
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Entwurf speichern" })).toBeDisabled();
    await expect(canvas.queryByText(/Geplanter Beginn:/)).not.toBeInTheDocument();
    await expect(canvas.getByText(/Ein früherer Veröffentlichungsversuch ist noch offen/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Neustart vorbereitet/)).toBeVisible();
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeEnabled();
    await expect(canvas.getByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" })).toBeVisible();
    await expect(canvas.queryByText(/Arbeitswoche bestätigt/)).not.toBeInTheDocument();
  },
};

function restartAgainstCurrentBaseClient(): BrowserApiClient {
  const currentId = "22222222-2222-4222-8222-222222222222";
  const successorId = "33333333-3333-4333-8333-333333333333";
  const futureDraft = { ...expiredDraft, effectiveFrom: nextMondayIso(), activationMode: "future_monday", basePublicationId: successorId, basePublicationRevision: 5 };
  const apiClient = client({
    googleConnected: true, immediateAllowed: true, restartAvailable: true, version: futureDraft,
    publication: { ...latestPublished, status: "preparing", syncState: "delayed", activationMode: "future_monday", effectiveAt: "2099-01-11T23:00:00Z" },
    restart: {
      after: { ...restartedContext, version: { ...futureDraft, id: "fresh-future-private" },
        editBase: { basePublicationId: currentId, basePublicationRevision: 4, windows: publishedWindows } },
      result: { version: { ...futureDraft, id: "fresh-future-private" }, restart: { state: "ready", recovery: null } },
    },
  });
  return { requestJson: (input, init) => {
    if (String(input) === "/api/team-workweek/private-draft" && init?.method === "POST") {
      const draft = init.json as Record<string, unknown>;
      if (draft.basePublicationId !== currentId || draft.basePublicationRevision !== 4) {
        return Promise.resolve({ body: { error: "Die aktuelle Ausgangsversion ist erforderlich." }, response: new Response(null, { status: 409 }) });
      }
    }
    return apiClient.requestJson(input, init);
  } } as BrowserApiClient;
}

export const RestartsAMondayAgainstTheCurrentWeekAndKeepsItsSuccessor: Story = {
  args: { profile, apiClient: restartAgainstCurrentBaseClient() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Neustart vorbereitet/)).toBeVisible();
    await userEvent.selectOptions(canvas.getByRole("combobox",{name:"Arbeitswoche auswählen"}),workweekStart());
    await waitFor(()=>expect(canvas.getByRole("combobox",{name:"Arbeitswoche auswählen"})).toHaveValue(workweekStart()));
    await userEvent.clear(canvas.getByLabelText("Montag, Fenster 1, Ende"));
    await userEvent.type(canvas.getByLabelText("Montag, Fenster 1, Ende"), "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Entwurf speichern" }));
    await expect(await canvas.findByText("Entwurf gespeichert. Noch nicht veröffentlicht.")).toBeVisible();
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toBeInTheDocument();
    await expect(canvas.getByText(/spätere Planungen bleiben erhalten/)).toBeVisible();
  },
};

export const RetainsEditsWhileTheGoogleOutcomeIsUncertain: Story = {
  args: { profile, apiClient: client({
    googleConnected: true, immediateAllowed: true, restartAvailable: true,
    version: { ...expiredDraft, activationMode: "future_monday", effectiveFrom: nextMondayIso() },
    publication: { ...latestPublished, status: "preparing", syncState: "delayed", activationMode: "future_monday", effectiveAt: "2099-01-11T23:00:00Z" },
    restart: { status: 202, after: {}, result: { restart: { state: "delayed", recovery: "retry", reason: "uncertain" } } },
  }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toBeDisabled();
    await userEvent.clear(canvas.getByLabelText("Montag, Fenster 1, Ende"));
    await userEvent.type(canvas.getByLabelText("Montag, Fenster 1, Ende"), "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Google hat die letzte Anfrage noch nicht eindeutig bestätigt/)).toBeVisible();
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" })).toBeEnabled();
    await expect(canvas.queryByText(/Neustart vorbereitet/)).not.toBeInTheDocument();
  },
};

export const WaitsForTheActiveGoogleRequestBeforeRestarting: Story = {
  ...RetainsEditsWhileTheGoogleOutcomeIsUncertain,
  args: { profile, apiClient: client({
    googleConnected: true, immediateAllowed: true, restartAvailable: true, version: expiredDraft,
    publication: { ...latestPublished, status: "preparing", syncState: "delayed", effectiveAt: "2099-01-11T23:00:00Z" },
    restart: { status: 202, after: {}, result: { restart: { state: "delayed", recovery: "retry", reason: "in_progress" } } },
  }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await userEvent.clear(canvas.getByLabelText("Montag, Fenster 1, Ende"));
    await userEvent.type(canvas.getByLabelText("Montag, Fenster 1, Ende"), "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Eine Google-Anfrage läuft noch/)).toBeVisible();
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" })).toBeEnabled();
  },
};

export const KeepsAnUntrackedOlderAttemptBlocked: Story = {
  args: { profile, apiClient: client({
    googleConnected: true, immediateAllowed: true, restartAvailable: true,
    version: { ...expiredDraft, activationMode: "future_monday", effectiveFrom: nextMondayIso() },
    publication: { ...latestPublished, status: "preparing", syncState: "delayed", activationMode: "future_monday", effectiveAt: "2099-01-11T23:00:00Z" },
    restart: { status: 202, after: {}, result: { restart: { state: "delayed", recovery: "retry", reason: "legacy_untracked" } } },
  }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toBeDisabled();
    await userEvent.clear(canvas.getByLabelText("Montag, Fenster 1, Ende"));
    await userEvent.type(canvas.getByLabelText("Montag, Fenster 1, Ende"), "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Dieser ältere Versuch kann noch nicht sicher abgebrochen werden/)).toBeVisible();
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await expect(canvas.getByRole("combobox", { name: "Arbeitswoche auswählen" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Entwurf speichern" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeDisabled();
    await expect(canvas.queryByText(/Neustart vorbereitet/)).not.toBeInTheDocument();
    await expect(canvas.getByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" })).toBeVisible();
  },
};


export const BlocksPublicationUntilRestartContextCanBeReloaded: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true, restartAvailable: true, failRestartContextOnce: true, version: expiredDraft,
    restart: { after: restartedContext, result: { version: restartedDraft, restart: { state: "ready", recovery: null } } },
  }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await userEvent.clear(canvas.getByLabelText("Montag, Fenster 1, Ende"));
    await userEvent.type(canvas.getByLabelText("Montag, Fenster 1, Ende"), "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Der aktuelle Teamstand konnte noch nicht geladen werden/)).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeDisabled();
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Aktuellen Stand laden" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeEnabled());
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await expect(canvas.getByText(/spätere Planungen bleiben erhalten/)).toBeVisible();
  },
};

export const RetainsLocalInputsWhenRestartNeedsReconnection: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true, restartAvailable: true, version: expiredDraft,
    restart: { status: 202, after: {}, result: { restart: { state: "delayed", recovery: "reconnect" } } },
  }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await userEvent.clear(canvas.getByLabelText("Montag, Fenster 1, Ende"));
    await userEvent.type(canvas.getByLabelText("Montag, Fenster 1, Ende"), "18:00");
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Neustart verzögert. Verbinde Google erneut/)).toBeVisible();
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await expect(canvas.getByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" })).toBeEnabled();
  },
};


export const ConfirmsGoogleReconciliationAtItsActualActivation: Story = {
  args: { profile, apiClient: client({ reconciliation: { state: "updated", recovery: null, lastSuccessfulSyncAt: "2026-10-14T12:00:00Z",
    effectiveAt: "2026-10-14T12:03:00Z", effectiveUntil: "2026-10-18T22:00:00Z" } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "App-Termine in Google prüfen" }));
    await expect(await canvas.findByText(/Google-Änderung bestätigt. Gültig ab 14.10.2026, 14:03 MESZ/)).toBeVisible();
    await expect(canvas.getByText(/Die geplante Änderung am 19.10.2026 bleibt erhalten/)).toBeVisible();
    await expect(canvas.queryByText(/ab dem nächsten Montag übernommen/)).not.toBeInTheDocument();
  },
};


export const ConfirmsAnExplicitVariantWithItsActualValidity: Story = {
  args: { profile, apiClient: client({ conflict: {
    id: "supported-conflict", conflictRevision: 2, state: "open", decision: null, observedAt: "2026-10-14T12:00:00Z",
    founderops: { effectiveFrom: nextMondayIso(), supported: false, windows: [] },
    google: { effectiveFrom: nextMondayIso(), activationMode: "immediate", windows: [{ weekday: 1, startMinute: 480, endMinute: 960 }] },
  }, conflictResolution: { after: { version: null, publication: null, latestPublished, minimumEffectiveFrom: nextMondayIso(), editBase: { windows: publishedWindows } },
    result: { status: "published", recovery: null, effectiveAt: "2026-10-14T12:03:00Z", effectiveUntil: "2026-10-18T22:00:00Z" },
  } }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "FounderOps übernehmen" })).toBeDisabled();
    await expect(canvas.getByText("Diese FounderOps-Variante kann derzeit nicht übernommen werden.")).toBeVisible();
    await expect(canvas.queryByText("Keine Arbeitszeitfenster")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Google übernehmen" }));
    await expect(await canvas.findByText(/Die Google-Variante wurde erneut geprüft.*Gültig ab 14.10.2026, 14:03 MESZ/)).toBeVisible();
    await expect(canvas.getByText(/Die geplante Änderung am 19.10.2026 bleibt erhalten/)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Google übernehmen" })).not.toBeInTheDocument();
  },
};


export const OffersRestartOnlyForARecoverablePublication: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true, restartAvailable: true, version: expiredDraft,
    publication: { ...latestPublished, id: "expired-operation", status: "preparing", syncState: "delayed", effectiveAt: "2026-10-14T12:03:00Z" },
  }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" })).toBeEnabled();
    await expect(canvas.getByText(/Bisheriger Teamstand sichtbar/)).toBeVisible();
    await expect(canvas.queryByText(/Wiederhole die Veröffentlichung/)).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeEnabled();
  },
};

function WorkweekGuide({ apiClient }: { apiClient: BrowserApiClient }) {
  const [data, setData] = useState(() => {
    window.localStorage.setItem("founderops.product-updates.seen.sebastian", JSON.stringify(productUpdates.map((update) => update.id)));
    return emptyPlanningShellState;
  });
  return <>
    <button onClick={() => window.dispatchEvent(new CustomEvent("fmd:start-feature-tour", { detail: { tourId: "workweek-current-publication-v1" } }))}>Arbeitswoche kennenlernen</button>
    <button onClick={() => window.dispatchEvent(new CustomEvent("fmd:open-product-updates"))}>Neuerungen öffnen</button>
    <ProductUpdatesProvider profileId={profile.id} />
    <PrivateTeamWorkweekCard apiClient={apiClient} profile={profile} />
    <FeatureTourProvider apiClient={apiClient} currentProfile={profile} data={data} setData={setData}
      openTaskPanel={() => undefined} selectedTaskId={null} setView={() => undefined} setWorkspace={() => undefined}
      source="supabase" workspace="team" />
  </>;
}

export const GuidesValidityAndPublicationInsideTheOwnerEditor: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true }) },
  render: ({ apiClient }) => <WorkweekGuide apiClient={apiClient} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole("button", { name: "Arbeitswoche kennenlernen" }));
    const editor = await page.findByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" });
    const guide = await page.findByRole("dialog", { name: "Woche auswählen" });
    await expect(editor.contains(guide)).toBe(true);
    await waitFor(() => expect(within(guide).getByRole("button", { name: "Tour schließen" })).toBeVisible());
    await userEvent.click(within(guide).getByRole("button", { name: "Weiter" }));
    const publishGuide = await page.findByRole("dialog", { name: "Entwurf speichern oder veröffentlichen" });
    await expect(editor.contains(publishGuide)).toBe(true);
    for (let index = 0; index < 6; index++) {
      await userEvent.tab();
      await expect(publishGuide.contains(canvasElement.ownerDocument.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(page.queryByRole("dialog", { name: "Entwurf speichern oder veröffentlichen" })).not.toBeInTheDocument());
    await expect(editor).toBeVisible();
    await waitFor(() => expect(editor.contains(canvasElement.ownerDocument.activeElement)).toBe(true));
    await expect(page.queryByText(/Arbeitswoche bestätigt/)).not.toBeInTheDocument();
  },
};

export const WorkweekGuidePreview: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true }) },
  render: ({ apiClient }) => <WorkweekGuide apiClient={apiClient} />,
};

export const StartsTheWorkweekGuideFromTheProductGallery: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true }) },
  render: ({ apiClient }) => <WorkweekGuide apiClient={apiClient} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole("button", { name: "Neuerungen öffnen" }));
    await expect(await page.findByRole("dialog", { name: "Arbeitswochen auswählen und geplante Zeiten ändern" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Lass dich leiten" }));
    const guide = await page.findByRole("dialog", { name: "Woche auswählen" });
    await expect(page.getByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" }).contains(guide)).toBe(true);
    await userEvent.click(within(guide).getByRole("button", { name: "Tour schließen" }));
    await waitFor(() => expect(page.getByRole("button", { name: "Editor schließen" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(page.getByRole("button", { name: "Arbeitswoche bearbeiten" })).toHaveFocus());
    await expect(page.queryByText(/Arbeitswoche bestätigt/)).not.toBeInTheDocument();
  },
};

export const RestartKeyboardPreview: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true, restartAvailable: true, failRestartContextOnce: true, version: expiredDraft,
    restart: { after: restartedContext, result: { version: restartedDraft, restart: { state: "ready", recovery: null } } },
  }) },
};

export const LeavesUnsavedInputsIntactWhenTheGuideCloses: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true }) },
  render: ({ apiClient }) => <WorkweekGuide apiClient={apiClient} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await userEvent.clear(page.getByLabelText("Montag, Fenster 1, Ende"));
    await userEvent.type(page.getByLabelText("Montag, Fenster 1, Ende"), "18:00");
    window.dispatchEvent(new CustomEvent("fmd:start-feature-tour", { detail: { tourId: "workweek-current-publication-v1" } }));
    const guide = await page.findByRole("dialog", { name: "Woche auswählen" });
    await userEvent.tab({ shift: true });
    await expect(guide.contains(canvasElement.ownerDocument.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(page.queryByRole("dialog", { name: "Woche auswählen" })).not.toBeInTheDocument());
    await expect(page.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("18:00");
    await waitFor(() => expect(page.getByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" }).contains(canvasElement.ownerDocument.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    await expect(await page.findByRole("alertdialog", { name: "Ungespeicherte Änderungen verwerfen?" })).toBeVisible();
  },
};

export const ReleasesTheGuideEvenBeforeDriversFirstFrame: Story = {
  args: { profile, apiClient: client({ immediateAllowed: true }) },
  render: ({ apiClient }) => <WorkweekGuide apiClient={apiClient} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await waitFor(() => expect(page.getByRole("button", { name: "Editor schließen" })).toHaveFocus());
    const requestFrame = window.requestAnimationFrame;
    const queuedFrames: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => queuedFrames.push(callback);
    try {
      window.dispatchEvent(new CustomEvent("fmd:start-feature-tour", { detail: { tourId: "workweek-current-publication-v1" } }));
      const guide = await page.findByRole("dialog", { name: "Woche auswählen" });
      await userEvent.click(within(guide).getByRole("button", { name: "Tour schließen" }));
    } finally {
      window.requestAnimationFrame = requestFrame;
      queuedFrames.forEach((callback) => requestFrame(callback));
    }
    await waitFor(() => expect(page.getByRole("button", { name: "Editor schließen" })).toHaveFocus());
    window.dispatchEvent(new CustomEvent("fmd:start-feature-tour", { detail: { tourId: "workweek-current-publication-v1" } }));
    const restartedGuide = await page.findByRole("dialog", { name: "Woche auswählen" });
    await userEvent.click(within(restartedGuide).getByRole("button", { name: "Tour schließen" }));
    await waitFor(() => expect(page.getByRole("button", { name: "Editor schließen" })).toHaveFocus());
  },
};


function legacyMondayClient(): BrowserApiClient {
  const before = client({ googleConnected: true, preparedSuccessor: { ...latestPublished, id: "legacy-monday", effectiveFrom: "2026-10-19" }, minimumEffectiveFrom: "2026-10-26" });
  const after = client({ googleConnected: true, latestPublished: { ...latestPublished, id: "legacy-monday", effectiveFrom: "2026-10-19" }, minimumEffectiveFrom: "2026-10-26", editBase: { windows: { ...publishedWindows, monday: [{ start: "12:00", end: "16:00" }] } } });
  return { requestJson: (input, init) => (Date.now() < Date.parse("2026-10-18T22:00:00Z") ? before : after).requestJson(input, init) } as BrowserApiClient;
}

function approachingLegacyMonday() {
  const OriginalDate = Date;
  const began = performance.now();
  const base = OriginalDate.parse("2026-10-18T21:59:58Z");
  class BoundaryDate extends OriginalDate {
    constructor(value?: string | number | Date) { super(value === undefined ? base + performance.now() - began : value); }
    static now() { return base + performance.now() - began; }
  }
  globalThis.Date = BoundaryDate as DateConstructor;
  return () => { globalThis.Date = OriginalDate; };
}

export const RefreshesAnOpenCleanEditorAtALegacyMonday: Story = {
  args: { profile, apiClient: legacyMondayClient() },
  beforeEach: approachingLegacyMonday,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await expect(canvas.getByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("09:00");
    await waitFor(() => expect(canvas.getByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("12:00"), { timeout: 5000 });
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("16:00");
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeEnabled();
  },
};

export const KeepsUnsavedInputsAtALegacyMonday: Story = {
  args: { profile, apiClient: legacyMondayClient() },
  beforeEach: approachingLegacyMonday,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    const start = canvas.getByLabelText("Montag, Fenster 1, Beginn");
    await userEvent.clear(start);
    await userEvent.type(start, "08:00");
    await waitFor(() => expect(canvas.getByText(/Die geplante Arbeitswoche gilt jetzt\. Deine Eingaben bleiben erhalten/)).toBeVisible(), { timeout: 5000 });
    await expect(start).toHaveValue("08:00");
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("17:00");
  },
};

export const CarriesUnsavedTimesIntoTheNewWeekWithoutBackdating: Story = {
  args:{profile,apiClient:legacyMondayClient()},
  beforeEach:approachingLegacyMonday,
  play:async({canvasElement})=>{
    const canvas=within(canvasElement);
    await userEvent.click(await canvas.findByRole("button",{name:"Arbeitswoche bearbeiten"}));
    await userEvent.clear(canvas.getByLabelText("Montag, Fenster 1, Beginn"));
    await userEvent.type(canvas.getByLabelText("Montag, Fenster 1, Beginn"),"08:00");
    const carry=await canvas.findByRole("button",{name:"Eingaben für diese Woche übernehmen"},{timeout:5000});
    await expect(canvas.getByRole("button",{name:"Änderung in Google & Team veröffentlichen"})).toBeDisabled();
    await userEvent.click(carry);
    await waitFor(()=>expect(canvas.getByRole("combobox",{name:"Arbeitswoche auswählen"})).toHaveValue("2026-10-19"));
    await expect(canvas.getByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("08:00");
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("17:00");
    await expect(canvas.getByRole("button",{name:"Änderung in Google & Team veröffentlichen"})).toBeEnabled();
  },
};


export const RestartsAnExpiredAutomaticGoogleCorrectionWithoutInventingAConflict: Story = {
  args: { profile, apiClient: client({ googleConnected: true,
    reconciliation: { state: "delayed", recovery: "restart", lastSuccessfulSyncAt: latestPublished.lastSyncAt },
    reconciliationAfter: { version: { ...expiredDraft, id: "automatic-google-source" },
      publication: { ...latestPublished, id: "automatic-operation", status: "preparing", syncState: "delayed", effectiveAt: "2020-09-07T07:03:00Z" },
      latestPublished, editBase: { windows: publishedWindows }, minimumEffectiveFrom: nextMondayIso(), immediateAllowed: true, restartAvailable: true },
    restart: { after: restartedContext, result: { version: restartedDraft, restart: { state: "ready", recovery: null } } },
  }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "App-Termine in Google prüfen" }));
    await expect(await canvas.findByText(/Die Ausgangsversion hat sich geändert\. Beginne die Bearbeitung mit dem aktuellen Stand neu/)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "FounderOps übernehmen" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Bearbeitung fortsetzen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Mit aktuellem Stand neu beginnen" }));
    await expect(await canvas.findByText(/Neustart vorbereitet/)).toBeVisible();
    await expect(canvas.getByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("09:00");
    await expect(canvas.getByRole("button", { name: "Änderung in Google & Team veröffentlichen" })).toBeEnabled();
    await expect(canvas.queryByText(/Arbeitswoche bestätigt/)).not.toBeInTheDocument();
  },
};
