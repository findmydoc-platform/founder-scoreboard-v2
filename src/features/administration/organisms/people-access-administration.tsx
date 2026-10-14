"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { AdministrationWorkspaceModel, PersonAdministrationPatch } from "@/features/administration/model/administration-read-model";
import { AdministratorAccessRow } from "@/features/administration/molecules/administrator-access-row";
import { PersonAccessDetailPanel } from "@/features/administration/molecules/person-access-detail-panel";
import { UiTextInput } from "@/shared/atoms/ui-primitives";
import { DataEmptyRow, DataHeaderCell, DataTableFrame, DataTableHead } from "@/shared/molecules/data-surface";

export function PeopleAccessAdministration({ busy, model, showTechnicalIdentity, onSavePerson }: {
  busy: boolean;
  model: AdministrationWorkspaceModel;
  showTechnicalIdentity: boolean;
  onSavePerson: (profileId: string, patch: PersonAdministrationPatch) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(model.people[0]?.id || "");
  const people = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("de");
    return term ? model.people.filter((person) => `${person.name} ${person.orgRole} ${person.platformRole}`.toLocaleLowerCase("de").includes(term)) : model.people;
  }, [model.people, query]);
  const selected = model.people.find((person) => person.id === selectedId) || null;

  return (
    <div className={`grid gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_23rem]" : ""}`}>
      <DataTableFrame
        title="Personen & Zugänge"
        description="Team-Mitglieder, ihre Systemzugänge und administrativen Berechtigungen."
        caption="Personen, technische Zugänge und Adminberechtigungen"
        results={[{ id: "people", visibleCount: people.length, totalCount: model.people.length }]}
        filtering={{ mode: "embedded", toolbar: <div className="border-b border-slate-100 p-4"><label className="relative block"><span className="sr-only">Person suchen</span><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><UiTextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Person suchen" inputSize="lg" inputPadding="md" className="w-full pl-10" /></label></div> }}
        minWidth={showTechnicalIdentity ? 660 : 480}
      >
        <DataTableHead><tr><DataHeaderCell>Name</DataHeaderCell><DataHeaderCell>Rolle</DataHeaderCell>{showTechnicalIdentity && <DataHeaderCell>GitHub</DataHeaderCell>}{showTechnicalIdentity && <DataHeaderCell>Google Chat</DataHeaderCell>}<DataHeaderCell>Admin-Zugang</DataHeaderCell></tr></DataTableHead>
        <tbody>{people.length ? people.map((person) => <AdministratorAccessRow key={person.id} person={person} selected={person.id === selectedId} showTechnicalIdentity={showTechnicalIdentity} onSelect={() => setSelectedId(person.id)} />) : <DataEmptyRow colSpan={showTechnicalIdentity ? 5 : 3}>Keine passende Person gefunden.</DataEmptyRow>}</tbody>
      </DataTableFrame>
      {selected && <PersonAccessDetailPanel key={`${selected.id}:${selected.githubLogin}:${selected.googleChatUserId}:${selected.googleChatDmSpace}:${selected.notificationsEnabled}:${selected.administratorAccess.eligible}`} busy={busy} person={selected} showTechnicalIdentity={showTechnicalIdentity} onClose={() => setSelectedId("")} onSave={(patch) => onSavePerson(selected.id, patch)} />}
    </div>
  );
}
