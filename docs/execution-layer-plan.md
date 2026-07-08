# Execution Layer Plan

Stand: 27. Mai 2026

## Ziel

Der Founder Scoreboard soll nicht nur Planung, Reviews und Dokumentation abbilden, sondern die tägliche Ausführung aktiv steuern. Diese geplante Feature-Schicht bündelt drei zusammenhängende Workflows:

- Focus Board / Heute-Modus
- Aging & Hygiene Alerts

Andere Agents und Chats sollen diese Planung berücksichtigen, bevor sie weitere Task-, Sprint- oder Review-Flows erweitern.

## 1. Focus Board / Heute-Modus

Zweck: Jede Person sieht sofort, was heute konkret relevant ist.

Geplanter Umfang:

- Maximal drei Fokus-Aufgaben pro Person.
- Je Aufgabe ein klarer nächster Schritt.
- Prominente Anzeige von Blockern, Review-Warteschlangen und nahen Sprint-Terminen.
- End-of-Day Check-in mit Status: erledigt, blockiert, verschoben oder Entscheidung nötig.
- Vorschläge aus vorhandenen Signalen: Priorität, Sprint-Ende, offene Blocker, wartende Aufgaben und fehlende Updates.

Nutzen:

- Weniger Kontextwechsel.
- Klarere Tagesprioritäten.
- Früheres Melden von Blockern.
- Bessere Sprint-Ausführung.

## 2. Aging & Hygiene Alerts

Zweck: Die App soll Qualitätsprobleme aktiv melden, statt dass Volkan oder andere sie manuell suchen müssen.

Geplanter Umfang:

- P0 ohne Owner oder ohne klaren nächsten Schritt.
- Aufgabe ohne Acceptance Criteria oder Definition of Done.
- Blocker ohne Kommentar oder ohne Verantwortlichen.
- Review länger als definierte Frist offen.
- Sprint-Aufgabe ohne Evidence Link.
- Aufgabe ohne Update seit definierter Frist, z. B. 48 Stunden.
- GitHub-Sync nicht aktuell oder fehlender GitHub-Link bei Aufgaben, die synchronisiert werden sollen.

Nutzen:

- Bessere Datenqualität.
- Weniger vergessene Aufgaben.
- Frühere Eskalation.
- Weniger manuelle Kontrolle.

## Umsetzungsstand

- Datenmodell, Supabase-Migration, RLS/Grants, Schema-Verify und Health Check sind für Focus Items angelegt.
- Execution ist als eigener Workspace in der gemeinsamen App-Shell verfügbar.
- Heute-Fokus unterstützt maximal drei Aufgaben pro Person, nächsten Schritt, Statuswechsel, Entfernen, Verschieben offener Fokusaufgaben und Vorschläge aus Task-Signalen.
- Tagesabschluss zeigt Abschlussquote, offene Fokusaufgaben und direkte Abschlussaktionen für erledigt, blockiert, verschoben oder Entscheidung nötig.
- Team-Fokus heute und Fokus-Verlauf zeigen, ob der Tagesfokus nicht nur individuell, sondern über das Team hinweg gesetzt und abgeschlossen wird.
- Hygiene Alerts prüfen Qualität, Blocker, Review-Aging, Evidence, Abhängigkeiten, fehlende Updates und GitHub-Sync. Jeder Alert zeigt eine nächste Aktion und kann als Fokusaktion übernommen werden.
- Aufgaben-Detailseite und Detailpanel zeigen Fokus-Kontext.

## Umsetzungshinweise

- Keine parallele Navigation oder zweite Shell bauen; vorhandene App-Shell und gemeinsame Sidebar nutzen.
- Supabase-Änderungen nur additiv: neue Tabellen, Spalten, Views, Policies, Grants und Indizes sind erlaubt; keine destruktiven Änderungen ohne explizite Bestätigung.
- UI-Controls müssen die bestehenden Custom-Komponenten nutzen; keine nativen Selects oder Browser-Datepicker.
- Deutsche sichtbare Texte müssen echte UTF-8-Umlaute verwenden.
- Nach Frontend-, API- oder Datenmodelländerungen `pnpm test`, `pnpm run lint` und `pnpm run build` ausführen.

## Vorgeschlagene Reihenfolge

1. Gemeinsames Datenmodell für Focus und Hygiene ergänzen.
2. Hygiene-Signale zuerst als berechnete, nachvollziehbare Checks implementieren.
3. Focus Board als neue operative Ansicht in der bestehenden App-Shell ergänzen.
4. Contract Tests für beide Workflows ergänzen.
