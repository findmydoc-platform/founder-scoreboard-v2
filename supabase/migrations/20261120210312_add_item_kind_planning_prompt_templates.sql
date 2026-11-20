alter table public.planning_prompt_templates
  drop constraint planning_prompt_template_kind,
  add constraint planning_prompt_template_kind check (kind in ('general', 'initiative', 'deliverable', 'sub_issue'));

insert into public.planning_prompt_templates (kind, text)
values
  ('initiative', $prompt$Beschreibe das Ziel der Initiative und die gewünschte Wirkung. Ordne die Initiative einem bestehenden Epic oder Meilenstein zu und zeige, warum die Wirkung zu dessen Ziel beiträgt.

Formuliere eigenständige Erfolgskriterien, an denen sich die Wirkung erkennen lässt. Halte den Umfang und belegte Grenzen fest. Übernimm vereinbarte Verantwortlichkeiten. Entwirf einzelne Deliverables nur auf ausdrücklichen Auftrag.$prompt$),
  ('deliverable', $prompt$Ordne das Deliverable einer bestehenden Initiative zu. Beschreibe den aktuellen Zustand, das konkrete Problem und warum es jetzt relevant ist. Formuliere als Intended Outcome das überprüfbare Ergebnis, für das der Owner verantwortlich ist.

Nenne verbindliche Randbedingungen unter Scope & Constraints. Formuliere getrennte Acceptance Criteria für den fertigen Zustand und beschränke sie auf Punkte, die der Owner beeinflussen kann. Lass die Wahl der Arbeitsschritte und des Prüfverfahrens beim Owner, soweit keine belegte Vorgabe sie festlegt.

Halte Evidence und Definition of Done getrennt. Benenne den erforderlichen Nachweis und verweise bei Bedarf auf gemeinsame Qualitätsstandards.$prompt$),
  ('sub_issue', $prompt$Ordne das Sub-Issue einem bestehenden, freigegebenen Deliverable zu. Gib dem Arbeitsschritt einen konkreten Titel. Ergänze kurzen Kontext und technische Details, soweit sie bei der Ausführung helfen. Halte das Sub-Issue klein genug, um den Arbeitsschritt einzeln zu erledigen.

Ergänze einen Arbeitsauftrag nur bei Bedarf. Verwende die Abschnitte des Deliverables dabei als optionalen Kontext. Aus dem Arbeitsauftrag entstehen keine zusätzlichen Pflichtnachweise, Reviews oder Qualitätsfreigaben.$prompt$)
on conflict (kind) do nothing;
