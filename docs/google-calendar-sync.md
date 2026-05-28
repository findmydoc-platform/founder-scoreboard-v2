# Google Calendar Sync

Der Meeting Finder bleibt in Supabase führend. Manuelle Arbeitszeiten, Urlaub, Krankheit und Blocker werden direkt in der App gepflegt. Google Calendar ergänzt nur schreibgeschützte `busy`-Blocker, damit freie Slots realistischer werden.

## Setup

Benötigt wird ein Google-Service-Account mit domainweiter Delegation für den Google Workspace. Die Laufzeitumgebung braucht:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_KEY`

Pro Teamprofil steuern diese Felder den Import:

- `profiles.google_calendar_email`
- `profiles.google_calendar_sync_enabled`
- `profiles.google_calendar_last_synced_at`

Nur CEO oder Deputy dürfen den Sync auslösen. Founder können weiterhin ihre eigenen manuellen Verfügbarkeiten pflegen.

## Verhalten

`POST /api/calendar-sync` importiert die nächsten 14 Tage. Google-Termine werden als `availability.source = 'google_calendar'` gespeichert und blockieren Slots im Meeting Finder. Bestehende Google-Blocker werden anhand von Kalender-E-Mail und Event-ID aktualisiert.

Google-Blocker im aktuellen Sync-Fenster werden entfernt, wenn sie im Google-Kalender nicht mehr vorkommen. Das Cleanup betrifft ausschließlich `source = 'google_calendar'`; manuelle Arbeitszeiten, Urlaub, Krankheit und manuelle Blocker bleiben unberührt.
