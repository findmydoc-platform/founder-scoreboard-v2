"use client";

import { Bell, CalendarClock, Check, MapPin, Pencil, Plus, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { eventDateRangeLabel, founderEventAudienceLabel, founderEventCategories, founderEventCategoryLabel, founderEventStatusLabel, founderEventStatuses, normalizeEventDateTimeInput } from "@/lib/founder-events";
import type { FounderEvent, Profile } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiNotice, UiPanel, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";
import { FilterField, FilterSegmentedControl, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";

import type { FounderEventDraft } from "../model/event-state";
import type { PlanningState } from "@/features/planning/model/planning-state";

type EventFilter = "upcoming" | "past" | "cancelled" | "all";
type EventCategoryFilter = FounderEvent["category"] | "all";

type Props = {
  planningState: PlanningState;
  events: FounderEvent[];
  profiles: Profile[];
  canManageEvents: boolean;
  pending: boolean;
  message: string;
  onCreateEvent: (draft: FounderEventDraft, submissionId: string) => Promise<void> | void;
  onUpdateEvent: (event: FounderEvent, draft: FounderEventDraft, submissionId: string) => Promise<void> | void;
};

function defaultStart() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(10, 0, 0, 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T10:00`;
}

function draftFromEvent(event?: FounderEvent): FounderEventDraft {
  return {
    id: event?.id,
    title: event?.title || "",
    category: event?.category || "other",
    startsAt: normalizeEventDateTimeInput(event?.startsAt || "") || defaultStart(),
    endsAt: normalizeEventDateTimeInput(event?.endsAt || ""),
    location: event?.location || "",
    description: event?.description || "",
    audienceMode: event?.audienceMode || "all",
    participantProfileIds: event?.participantProfileIds || [],
    reminderDaysBefore: event?.reminderDaysBefore ?? 7,
    status: event?.status || "planned",
  };
}

function filterEvent(event: FounderEvent, filter: EventFilter, now: number) {
  const startsAt = new Date(event.startsAt).getTime();
  if (filter === "all") return true;
  if (filter === "cancelled") return event.status === "cancelled";
  if (filter === "past") return event.status !== "cancelled" && startsAt < now;
  return event.status === "planned" && startsAt >= now;
}

function sortEvents(events: FounderEvent[]) {
  return [...events].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export function EventsOverview({
  planningState,
  events,
  profiles,
  canManageEvents,
  pending,
  message,
  onCreateEvent,
  onUpdateEvent,
}: Props) {
  const [filter, setFilter] = useState<EventFilter>("upcoming");
  const [categoryFilter, setCategoryFilter] = useState<EventCategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<FounderEvent | null>(null);
  const [submissionId, setSubmissionId] = useState("");
  const [conflictBasis, setConflictBasis] = useState<FounderEvent | null>(null);
  const [conflictAdopted, setConflictAdopted] = useState(false);
  const [draft, setDraft] = useState<FounderEventDraft>(() => draftFromEvent());
  const [formPending, setFormPending] = useState(false);
  const [now] = useState(() => Date.now());
  const visibleEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("de");
    return sortEvents(events.filter((event) => (
      filterEvent(event, filter, now)
      && (categoryFilter === "all" || event.category === categoryFilter)
      && (!normalizedQuery || [event.title, event.description, event.location, founderEventCategoryLabel(event.category)].join(" ").toLocaleLowerCase("de").includes(normalizedQuery))
    )));
  }, [categoryFilter, events, filter, now, query]);
  const eventView = planningState.events();
  const operation = eventView.operations.find(item => item.id === submissionId);
  const unresolved = eventView.operations.filter(item => item.phase === "unconfirmed");
  const saveBlocked = operation?.phase === "unconfirmed" || operation?.phase === "saving" || (operation?.phase === "conflict" && !conflictAdopted);
  const feedback = <div className="space-y-2" aria-live="polite">{eventView.readStatus === "stale" ? <UiNotice>Die Eventdaten müssen erneut geprüft werden. <UiButton className="min-h-11" onClick={() => void planningState.refreshEvents()}>Events aktualisieren</UiButton></UiNotice> : null}{unresolved.map(item => <UiNotice key={item.id}>
    <p>{item.draft.title}: Ob das Event gespeichert wurde, ist noch unklar. Deine Eingaben bleiben erhalten. Prüfe zuerst die Speicherung.</p>
    <UiButton className="mt-2 min-h-11" disabled={item.checking} onClick={() => void planningState.checkEventOutcome(item.id)}>{item.checking ? "Aktueller Stand wird geprüft" : "Aktuellen Stand prüfen"}</UiButton>
  </UiNotice>)}</div>;
  const metrics = {
    upcoming: events.filter((event) => filterEvent(event, "upcoming", now)).length,
    past: events.filter((event) => filterEvent(event, "past", now)).length,
    cancelled: events.filter((event) => filterEvent(event, "cancelled", now)).length,
  };
  const activeFilters: ActiveFilter[] = categoryFilter !== "all" ? [{
    id: "category",
    label: `Kategorie: ${founderEventCategoryLabel(categoryFilter)}`,
    onRemove: () => setCategoryFilter("all"),
  }] : [];

  const openCreate = () => {
    setEditingEvent(null);
    setDraft(draftFromEvent());
    setSubmissionId(crypto.randomUUID());
    setConflictBasis(null); setConflictAdopted(false);
    setFormOpen(true);
  };

  const openEdit = (event: FounderEvent) => {
    setEditingEvent(structuredClone(event));
    setDraft(draftFromEvent(event));
    setSubmissionId(crypto.randomUUID());
    setConflictBasis(null); setConflictAdopted(false);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingEvent(null);
    setDraft(draftFromEvent());
  };

  const toggleParticipant = (profileId: string) => {
    setDraft((current) => ({
      ...current,
      participantProfileIds: current.participantProfileIds.includes(profileId)
        ? current.participantProfileIds.filter((id) => id !== profileId)
        : [...current.participantProfileIds, profileId],
    }));
  };

  const submit = async () => {
    if (saveBlocked) return;
    setFormPending(true);
    setConflictAdopted(false);
    try {
      if (editingEvent) {
        await onUpdateEvent(editingEvent, draft, submissionId);
      } else {
        await onCreateEvent(draft, submissionId);
      }
      closeForm();
    } catch {
      // The command hook surfaces the error; keep the form and draft open for correction.
    } finally {
      setFormPending(false);
    }
  };

  const eventForm = formOpen && canManageEvents ? (
    <UiPanel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{editingEvent ? "Event bearbeiten" : "Event eintragen"}</h2>
          <p className="mt-1 text-sm text-slate-600">Reminder laufen über die FounderOps-Glocke und Google Chat.</p>
        </div>
        <button type="button" onClick={closeForm} disabled={formPending} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-50 disabled:opacity-50" aria-label="Event-Formular schließen">
          <X size={16} />
        </button>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Titel
          <UiTextInput
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            className="h-10 px-3"
            placeholder="z. B. Gesundheitsmesse Düsseldorf"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Kategorie
          <CustomSelect value={draft.category} onChange={(value) => setDraft({ ...draft, category: value as FounderEvent["category"] })} className="h-10 text-sm" options={founderEventCategories} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Start
          <CustomDatePicker value={draft.startsAt} onChange={(value) => setDraft({ ...draft, startsAt: value })} mode="datetime" className="h-10 text-sm" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Ende
          <CustomDatePicker value={draft.endsAt} onChange={(value) => setDraft({ ...draft, endsAt: value })} mode="datetime" className="h-10 text-sm" />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Ort
          <UiTextInput
            value={draft.location}
            onChange={(event) => setDraft({ ...draft, location: event.target.value })}
            className="h-10 px-3"
            placeholder="z. B. Düsseldorf"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Erinnerung
          <UiTextInput
            value={String(draft.reminderDaysBefore)}
            onChange={(event) => setDraft({ ...draft, reminderDaysBefore: Number(event.target.value) || 0 })}
            className="h-10 px-3"
            inputMode="numeric"
            placeholder="7"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-500 lg:col-span-2">
          Beschreibung
          <UiTextArea
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            className="min-h-24 px-3"
            placeholder="Kontext, Vorbereitung oder wichtige Hinweise"
          />
        </label>
        <div className="grid gap-2 lg:col-span-2">
          <div className="text-xs font-semibold text-slate-500">Zielgruppe</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDraft({ ...draft, audienceMode: "all", participantProfileIds: [] })}
              className={`h-8 rounded-md border px-3 text-xs font-semibold ${draft.audienceMode === "all" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}
            >
              Alle aktiven Profile
            </button>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, audienceMode: "selected" })}
              className={`h-8 rounded-md border px-3 text-xs font-semibold ${draft.audienceMode === "selected" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}
            >
              Ausgewählte Profile
            </button>
          </div>
          {draft.audienceMode === "selected" && (
            <div className="flex flex-wrap gap-2">
              {profiles.map((profile) => {
                const selected = draft.participantProfileIds.includes(profile.id);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => toggleParticipant(profile.id)}
                    className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${selected ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}
                  >
                    {selected && <Check size={13} />}
                    {profile.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {editingEvent && (
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Status
            <CustomSelect value={draft.status} onChange={(value) => setDraft({ ...draft, status: value as FounderEvent["status"] })} className="h-10 text-sm" options={founderEventStatuses} />
          </label>
        )}
      </div>
      {operation?.phase === "conflict" && !conflictAdopted ? <UiNotice className="mt-4">
        <p>Das Event wurde inzwischen geändert. Vergleiche die Änderungen und übernimm den aktuellen Stand, bevor du erneut speicherst. Deine Eingaben bleiben erhalten.</p>
        {conflictBasis ? <><p className="mt-2">Aktuell gespeichert: {conflictBasis.title} · {eventDateRangeLabel(conflictBasis)} · {founderEventStatusLabel(conflictBasis.status)}</p><UiButton className="mt-2 min-h-11" onClick={() => { setEditingEvent(conflictBasis); setConflictAdopted(true); }}>Aktuellen Stand übernehmen</UiButton></> : <UiButton className="mt-2 min-h-11" onClick={async () => { if (await planningState.refreshEvents()) setConflictBasis(planningState.events().events.find(item => item.id === editingEvent?.id) || null); }}>Aktuellen Stand laden</UiButton>}
      </UiNotice> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <UiButton onClick={closeForm} disabled={formPending} className="text-slate-600">
          Abbrechen
        </UiButton>
        <UiButton onClick={() => void submit()} disabled={saveBlocked || pending || formPending || !draft.title.trim() || !draft.startsAt || (draft.audienceMode === "selected" && !draft.participantProfileIds.length)} variant="primary">
          {formPending ? "Speichert..." : editingEvent ? "Event speichern" : "Event erstellen"}
        </UiButton>
      </div>
    </UiPanel>
  ) : null;

  if (eventView.readStatus === "not-loaded" || eventView.readStatus === "forbidden") return <UiNotice>Events sind in dieser Sitzung nicht verfügbar.</UiNotice>;

  if (!events.length) {
    return (
      <div className="grid gap-4">
        <UiPanel>
          <div className="grid gap-3 py-6 text-center">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Noch keine Events</h2>
              <p className="mt-1 text-sm text-slate-600">Trage den ersten Gründertermin ein, sobald ein relevanter Termin feststeht.</p>
            </div>
            {canManageEvents && (
              <div>
                <UiButton onClick={openCreate} variant="primary">
                  <Plus size={16} />
                  Event eintragen
                </UiButton>
              </div>
            )}
            {message && <UiNotice className="mx-auto max-w-2xl font-medium leading-normal">{message}</UiNotice>}
          </div>
        </UiPanel>
        {feedback}
        {eventForm}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <UiPanel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Event-Zentrale</h2>
            <p className="mt-1 text-sm text-slate-600">Wichtige Gründertermine, Messen, Reisen und rechtliche Termine an einem Ort.</p>
          </div>
          {canManageEvents && (
            <UiButton
              onClick={openCreate}
              variant="primary"
            >
              <Plus size={16} />
              Event eintragen
            </UiButton>
          )}
        </div>
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
          <EventMetric label="Bevorstehend" value={metrics.upcoming} />
          <EventMetric label="Vergangen" value={metrics.past} />
          <EventMetric label="Abgesagt" value={metrics.cancelled} />
          <EventMetric label="Gesamt" value={events.length} />
        </div>
        {message && <UiNotice className="mt-3 font-medium leading-normal">{message}</UiNotice>}
      </UiPanel>

      {feedback}
      <FilterToolbar
        searchLabel="Events durchsuchen"
        searchPlaceholder="Event, Ort oder Beschreibung suchen"
        query={query}
        onQueryChange={setQuery}
        expanded={filtersOpen}
        onExpandedChange={setFiltersOpen}
        activeFilters={activeFilters}
        isDirty={filter !== "upcoming" || categoryFilter !== "all" || Boolean(query)}
        onReset={() => { setQuery(""); setFilter("upcoming"); setCategoryFilter("all"); }}
        results={[{ id: "events", visibleCount: visibleEvents.length, totalCount: events.length }]}
        panelId="event-data-filters"
        primaryControls={(
          <FilterSegmentedControl
            label="Event-Zeitraum"
            value={filter}
            options={[
              { value: "upcoming", label: "Bevorstehend", count: metrics.upcoming },
              { value: "past", label: "Vergangen", count: metrics.past },
              { value: "cancelled", label: "Abgesagt", count: metrics.cancelled },
              { value: "all", label: "Alle", count: events.length },
            ]}
            onChange={setFilter}
          />
        )}
      >
        <FilterField label="Kategorie" className="max-w-xs">
          <CustomSelect
            aria-label="Nach Event-Kategorie filtern"
            value={categoryFilter}
            onChange={(value) => setCategoryFilter(value as EventCategoryFilter)}
            className="h-10 text-sm"
            options={[{ value: "all", label: "Alle Kategorien" }, ...founderEventCategories]}
          />
        </FilterField>
      </FilterToolbar>

      {eventForm}

      <section className="grid gap-3">
        {visibleEvents.map((event) => (
          <UiPanel key={event.id} as="article">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <UiBadge tone="blue">{founderEventCategoryLabel(event.category)}</UiBadge>
                  <UiBadge tone={event.status === "cancelled" ? "rose" : event.status === "done" ? "emerald" : "slate"}>
                    {founderEventStatusLabel(event.status)}
                  </UiBadge>
                  {event.reminderGeneratedAt && <UiBadge tone="emerald">Reminder erzeugt</UiBadge>}
                </div>
                <h3 className="mt-2 text-base font-semibold text-slate-950">{event.title}</h3>
                <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-1.5"><CalendarClock size={15} />{eventDateRangeLabel(event)}</span>
                  {event.location && <span className="inline-flex items-center gap-1.5"><MapPin size={15} />{event.location}</span>}
                  <span className="inline-flex items-center gap-1.5"><Users size={15} />{founderEventAudienceLabel(event, profiles)}</span>
                  <span className="inline-flex items-center gap-1.5"><Bell size={15} />{event.reminderDaysBefore} Tage vorher</span>
                </div>
                {event.description && <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">{event.description}</p>}
              </div>
              {canManageEvents && (
                <UiButton onClick={() => openEdit(event)} size="sm" className="text-slate-600">
                  <Pencil size={14} />
                  Bearbeiten
                </UiButton>
              )}
            </div>
          </UiPanel>
        ))}
        {!visibleEvents.length && (
          <UiEmptyState className="rounded-lg px-4 py-10">
            Keine Events für diesen Filter.
          </UiEmptyState>
        )}
      </section>
    </div>
  );
}

function EventMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}
