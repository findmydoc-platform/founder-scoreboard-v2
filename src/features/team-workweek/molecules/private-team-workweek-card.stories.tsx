import { useState } from "react";
import { HeaderCalendarAction } from "@/features/planning/molecules/header-calendar-action";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
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
  immediateAllowed?: boolean;
  googleConnected?: boolean;
  editBase?: { windows: typeof publishedWindows } | null;
  reconciliation?: Record<string, unknown>;
  latestPublished?: Record<string, unknown> | null;
  publication?: Record<string, unknown> | null;
  publish?: {
    after: Record<string, unknown>;
    result: Record<string, unknown>;
  };
  version?: Record<string, unknown> | null;
  saveError?: string;
  losePublishResponse?: boolean;
};

function client(options: ClientOptions = {}): BrowserApiClient {
  let privateBody = {
    ...(options.immediateAllowed !== undefined ? {immediateAllowed:options.immediateAllowed} : {}),
    editBase: options.editBase === undefined ? { windows: publishedWindows } : options.editBase,
    latestPublished: options.latestPublished === undefined ? latestPublished : options.latestPublished,
    minimumEffectiveFrom: nextMondayIso(),
    publication: options.publication || null,
    version: options.version || null,
  };
  let losePublishResponse = Boolean(options.losePublishResponse);
  return {
    requestJson: async (input: RequestInfo | URL, init?: { method?: string; json?: Record<string, unknown> }) => {
      const path = String(input);
      if (path === "/api/team-workweek/private-draft") {
        if (init?.method === "POST") {
          if (options.saveError) return { body: { error: options.saveError }, response: new Response(null, { status: 503 }) };
          const version = { id: "private-saved", timezone: "Europe/Berlin", status: "preparing", createdAt: new Date().toISOString(), ...init.json };
          privateBody = { ...privateBody, version };
          return response({ version });
        }
        return response(privateBody);
      }
      if (path.startsWith("/api/team-workweek/team?")) return response({ calendarWorkweeks: [], currentWorkweeks: [], referenceDate: "2026-09-07" });
      if (path === "/api/team-workweek/conflict") return response({ conflict: null });
      if (path === "/api/team-workweek/publish" && options.publish) {
        if (losePublishResponse) {
          losePublishResponse = false;
          throw new Error("Antwort der Veröffentlichung konnte nicht geladen werden.");
        }
        privateBody = options.publish.after as typeof privateBody;
        return response({ publication: options.publish.result });
      }
      if (path === "/api/team-workweek/reconcile") return response({ reconciliation: options.reconciliation || { state: "unchanged" } });
      if (path === "/api/google-workspace/status") {
        return response({ connection: { state: options.googleConnected ? "connected" : "not_connected", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null } });
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

export const PrefillsThePublishedWorkweek: Story = {
  args: { apiClient: client(), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await expect(await canvas.findByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("09:00");
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("17:00");
    await expect(canvas.getByLabelText("Gültigkeitsbeginn der Arbeitswoche")).toHaveTextContent(String(Number(nextMondayIso().slice(-2))));
  },
};

export const ContinuesThePrivateDraft: Story = {
  args: {
    apiClient: client({ version: {
        id: "private-1",
        effectiveFrom: "2026-09-21",
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
    await expect(canvas.getByLabelText("Gültigkeitsbeginn der Arbeitswoche")).toHaveTextContent("21");
  },
};

export const StartsTheFirstWorkweekEmpty: Story = {
  args: { apiClient: client({ editBase: null, latestPublished: null }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche einrichten" }));
    await expect(canvas.getByText("Hier veröffentlichte Zeiten werden in Google eingetragen. Selbst angelegte Google-Termine werden nicht automatisch übernommen.")).toBeVisible();
    await expect(canvas.getByText("Die Verbindung allein veröffentlicht keine Arbeitszeiten.")).toBeVisible();
    await expect((await canvas.findAllByText("Kein Arbeitszeitfenster")).length).toBeGreaterThan(0);
    await expect(canvas.queryByLabelText("Montag, Fenster 1, Beginn")).not.toBeInTheDocument();
    await expect(canvas.getByRole("radio", {name:/Nach Bestätigung/})).toBeChecked();
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
        effectiveFrom: "2026-09-21",
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
          latestPublished: { ...latestPublished, id: "publication-2", effectiveFrom: "2026-09-21", publicationRevision: 2 },
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
        effectiveFrom: "2026-09-21",
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
    await expect(canvas.getByText(/gültig ab 21\. Sept\./)).toBeInTheDocument();
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
    await userEvent.click(canvas.getByRole("button", { name: "Änderung privat speichern" }));
    await expect(await canvas.findByText(/Änderung privat gespeichert/)).toHaveTextContent("Im Team und in Google bleibt sie bis zur Veröffentlichung unverändert");
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
    await expect(canvas.getByRole("button", { name: "Änderung privat speichern" })).toBeDisabled();
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
    await expect(canvas.getByRole("button", { name: "Änderung privat speichern" })).toBeDisabled();
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
    await expect(canvas.getByText("Die Verbindung allein veröffentlicht keine Arbeitszeiten.")).toBeVisible();
  },
};

export const NamesAPreparedFutureScheduleSeparatelyFromAPrivateDraft: Story = {
  args: { apiClient: client({ latestPublished: { ...latestPublished, effectiveFrom: "2099-01-05" } }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Für Montag vorbereitet")).toBeVisible();
    await expect(canvas.getByText(/Vorbereitet: gültig ab/)).toBeVisible();
    await expect(canvas.queryByText("Privater Entwurf")).not.toBeInTheDocument();
  },
};

export const FirstPublicationHasExplicitValidityChoices: Story = {
  args: {profile, apiClient: client({latestPublished:null,editBase:null})},
  play: async ({canvasElement}) => {
    const canvas=within(canvasElement);
    await userEvent.click(await canvas.findByRole("button",{name:"Arbeitswoche einrichten"}));
    await expect(canvas.getByRole("radio",{name:/Nach Bestätigung/})).toBeVisible();
    await userEvent.click(canvas.getByRole("radio",{name:/Nach Bestätigung/}));
    await expect(canvas.queryByLabelText("Gültigkeitsbeginn der Arbeitswoche")).not.toBeInTheDocument();
    await expect(canvas.getByText(/2–3 Minuten Vorlauf/)).toBeVisible();
    await userEvent.click(canvas.getByRole("radio",{name:/Zukünftiger Montag/}));
    await expect(canvas.getByLabelText("Gültigkeitsbeginn der Arbeitswoche")).toBeVisible();
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
    await expect(canvas.getByRole("radio",{name:/Nach Bestätigung/})).toBeChecked();
    await userEvent.click(canvas.getByRole("button",{name:"Mittwoch: Fenster hinzufügen"}));
    await userEvent.click(canvas.getByRole("button",{name:"Änderung in Google & Team veröffentlichen"}));
    await waitFor(()=>expect(canvas.queryByRole("dialog")).not.toBeInTheDocument());
    await expect(canvas.getByText(/Arbeitswoche bestätigt\. Gültig ab 14\.10\.2026, 12:03 MESZ/)).toBeVisible();
    await expect(canvas.getByText(/gültig ab 14\.10\.2026, 12:03 MESZ/)).toBeVisible();
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
    await expect(canvas.getByRole("radio",{name:/Nach Bestätigung/})).toBeChecked();
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
