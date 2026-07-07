# Execution Layer Plan

Stand: 27. Mai 2026

## Ziel

Der Founder Scoreboard soll nicht nur Planung, Reviews und Dokumentation abbilden, sondern die tägliche Ausführung aktiv steuern. Diese geplante Feature-Schicht bündelt drei zusammenhängende Workflows:

- Focus Board / Heute-Modus
- Aging & Hygiene Alerts
- Decision-to-Task Links

Andere Agents und Chats sollen diese Planung berücksichtigen, bevor sie weitere Task-, Decision-, Sprint- oder Review-Flows erweitern.

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

## 3. Decision-to-Task Links

Zweck: Entscheidungen sollen operativ nachvollziehbar werden. Aus einer Decision muss erkennbar sein, welche Aufgaben daraus entstanden sind oder welche Aufgaben dadurch begründet werden.

Geplanter Umfang:

- Aufgaben mit Decisions verknüpfen.
- Aus einer Decision direkte Folgeaufgaben erzeugen.
- In der Aufgaben-Detailseite anzeigen, welche Decision die Aufgabe begründet.
- In der Decision-Detailansicht anzeigen, welche Aufgaben daraus folgen.
- Optionaler Hinweis, wenn eine Decision gelockt ist, aber noch keine Folgeaufgabe existiert.

Nutzen:

- Bessere Nachvollziehbarkeit.
- Weniger vergessene Folgearbeit.
- Klareres Warum hinter Aufgaben.
- Entscheidungen bleiben nicht nur Dokumentation, sondern werden in Arbeit übersetzt.

## Umsetzungsstand

- Datenmodell, Supabase-Migration, RLS/Grants, Schema-Verify und Health Check sind für Focus Items und Decision-Task Links angelegt.
- Execution ist als eigener Workspace in der gemeinsamen App-Shell verfügbar.
- Heute-Fokus unterstützt maximal drei Aufgaben pro Person, nächsten Schritt, Statuswechsel, Entfernen, Verschieben offener Fokusaufgaben und Vorschläge aus Task-Signalen.
- Tagesabschluss zeigt Abschlussquote, offene Fokusaufgaben und direkte Abschlussaktionen für erledigt, blockiert, verschoben oder Entscheidung nötig.
- Team-Fokus heute und Fokus-Verlauf zeigen, ob der Tagesfokus nicht nur individuell, sondern über das Team hinweg gesetzt und abgeschlossen wird.
- Hygiene Alerts prüfen Qualität, Blocker, Review-Aging, Evidence, Abhängigkeiten, fehlende Updates, GitHub-Sync und gelockte Decisions ohne Folgeaufgabe. Jeder Alert zeigt eine nächste Aktion und kann als Fokusaktion übernommen werden.
- Decision-Folgearbeit kann bestehende Aufgaben verknüpfen, Links entfernen und neue Folgeaufgaben aus Decisions erzeugen. Pro Decision wird sichtbar, wie viele Folgeaufgaben offen, erledigt oder blockiert sind.
- Aufgaben-Detailseite und Detailpanel zeigen Fokus-Kontext und begründende Decisions.

## Umsetzungshinweise

- Keine parallele Navigation oder zweite Shell bauen; vorhandene App-Shell und gemeinsame Sidebar nutzen.
- Supabase-Änderungen nur additiv: neue Tabellen, Spalten, Views, Policies, Grants und Indizes sind erlaubt; keine destruktiven Änderungen ohne explizite Bestätigung.
- UI-Controls müssen die bestehenden Custom-Komponenten nutzen; keine nativen Selects oder Browser-Datepicker.
- Deutsche sichtbare Texte müssen echte UTF-8-Umlaute verwenden.
- Nach Frontend-, API- oder Datenmodelländerungen `pnpm test`, `pnpm run lint` und `pnpm run build` ausführen.

## Vorgeschlagene Reihenfolge

1. Gemeinsames Datenmodell für Focus, Hygiene und Decision-Links ergänzen.
2. Hygiene-Signale zuerst als berechnete, nachvollziehbare Checks implementieren.
3. Focus Board als neue operative Ansicht in der bestehenden App-Shell ergänzen.
4. Decision-to-Task Links in Decision Log und Aufgaben-Detailseite integrieren.
5. Contract Tests für alle drei Workflows ergänzen.
