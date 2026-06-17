# FounderOps Agent API v1

Die FounderOps Agent API ist für externe ChatGPT- oder Codex-Sessions gedacht, die Aufgaben lesen, planen und über den bestehenden Task-Intake-Flow neue Aufgaben anlegen sollen. FounderOps führt dabei kein eigenes AI-Modell aus und gibt keine direkten Datenbank-Credentials weiter.

## Auth

Alle Endpunkte erwarten:

```http
Authorization: Bearer <agent-token>
```

In FounderOps wird nur der SHA-256-Hash des Tokens als Environment Variable gespeichert:

```env
FOUNDEROPS_AGENT_TOKEN_SHA256=<sha256-hex>
```

Token und Hash kannst du lokal erzeugen:

```powershell
node -e "const crypto=require('crypto'); const token=crypto.randomBytes(32).toString('base64url'); console.log('TOKEN='+token); console.log('SHA256='+crypto.createHash('sha256').update(token).digest('hex'))"
```

Speichere den Klartext-Token nur in deinem Passwortmanager oder in der externen ChatGPT/Codex-Action. In Vercel wird nur der Hash gesetzt. Bei Rotation erzeugst du ein neues Token, ersetzt den Hash und entfernst das alte Token aus allen externen Clients.

## Endpunkte

- `GET /api/agent/context`: kompaktes Planungsbild mit Projekt, Profilen, Sprints, Meilensteinen, Initiativen, RACI, Kennzahlen und Sicherheitsgrenzen.
- `GET /api/agent/tasks`: gefilterte Aufgabenliste mit Briefing, Review-Kontext, Evidence, Blocker- und Kommentar-Zusammenfassung.
- `POST /api/agent/task-intake/preview`: validiert Task-Intake-JSON ohne Datenbank-Schreibzugriff.
- `POST /api/agent/task-intake/commit`: erstellt valide Aufgaben über denselben serverseitigen Intake-Flow wie der CEO Intake.

Die OpenAPI-Datei liegt unter `/founderops-agent-openapi.json`.

## Erlaubte Aktionen

- Planungskontext lesen.
- Aufgaben lesen und filtern.
- Task-Intake-Preview erstellen.
- Valide Task-Intake-Aufgaben committen.

## Gesperrte Aktionen

- Keine direkten Supabase-Credentials oder Service-Role-Keys an externe Chats weitergeben.
- Keine GitHub-Provider-Tokens oder Google-Tokens als Agent-Auth verwenden.
- Kein Schreiben von Score, finaler Review-Entscheidung, RACI, Sprint-Konfiguration oder Review Owner.
- Keine AI-Funktion innerhalb von FounderOps einbauen. Externe Clients verbrauchen ihre eigenen Modell- und Tokenkontingente.

## Beispiele

```bash
curl -H "Authorization: Bearer $FOUNDEROPS_AGENT_TOKEN" \
  https://founder-ops.findmydoc.eu/api/agent/context
```

```bash
curl -H "Authorization: Bearer $FOUNDEROPS_AGENT_TOKEN" \
  "https://founder-ops.findmydoc.eu/api/agent/tasks?owner=sebastian&sprint=sprint-2&missingEvidence=true"
```

```bash
curl -X POST \
  -H "Authorization: Bearer $FOUNDEROPS_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"taskType":"deliverable","packageId":"GC1","sprintId":"sprint-2","owner":"sebastian","priority":"P1","hours":4,"title":"Beispielaufgabe prüfen","problemStatement":"Was ist unklar oder kaputt?","intendedOutcome":"Das Ergebnis ist nachvollziehbar sichtbar.","acceptanceCriteria":["Kriterium 1 ist erfüllt."],"evidenceRequired":"Link oder Screenshot.","definitionOfDone":"Der Review Owner kann die Aufgabe nachvollziehbar abnehmen."}]}' \
  https://founder-ops.findmydoc.eu/api/agent/task-intake/preview
```
