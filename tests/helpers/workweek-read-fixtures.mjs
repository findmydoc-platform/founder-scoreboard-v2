import { randomUUID } from "node:crypto";

// Persisted read states, with constraints and insertion triggers left enabled.
// These fixtures do not claim to execute the publication/provider workflow.
export async function workweekReadFixture(database, owner, weeks) {
  const clock = () => weeks.now ? Date.parse(weeks.now) : Date.now();
  const civilDay = (value, difference) => new Date(Date.parse(`${value}T12:00:00Z`) + difference * 86_400_000).toISOString().slice(0, 10);
  const historyWeek = civilDay(weeks.current, -7), beforeCurrent = civilDay(weeks.current, -1);
  const versions = [], publications = [], series = [], conflicts = [];
  /** @type {Record<string, string>} */
  const ids = {};
  const window = [{ weekday: 1, startMinute: 540, endMinute: 720 }];
  async function insert(table, values) {
    const columns = Object.keys(values);
    const result = await database.query(`insert into public.${table} (${columns.join(",")}) values (${columns.map((_, i) => `$${i + 1}`).join(",")}) returning *`, Object.values(values));
    return result.rows[0];
  }
  async function version(name, week, extra = {}) {
    const row = await insert("team_workweek_versions", { id: randomUUID(), owner_profile_id: owner, effective_from: week,
      created_at: new Date(clock() - 86_400_000 + versions.length * 1000), ...extra });
    versions.push(row.id); ids[name] = row.id;
    const saved = await insert("team_workweek_windows", { version_id: row.id, weekday: 1, start_minute: 540, end_minute: 720 });
    ids[`${name}Window`] = saved.id;
    return row.id;
  }
  async function publication(name, source, week, extra = {}) {
    const row = await insert("team_workweek_publications", { id: randomUUID(), source_version_id: source, owner_profile_id: owner,
      effective_from: week, windows: JSON.stringify(window), publication_revision: publications.length + 1, ...extra });
    publications.push(row.id); ids[name] = row.id; return row.id;
  }
  const confirmed = { status: "published", sync_state: "confirmed", published_at: new Date(clock() - 60_000), last_sync_at: new Date(clock() - 60_000) };
  async function base() {
    const v = await version("baseVersion", weeks.current);
    return publication("base", v, weeks.current, { ...confirmed, publication_revision: 1 });
  }
  async function draft(extra = {}) { return version("draft", weeks.future, extra); }
  async function automatic(expired = true) {
    const v = await version("automaticVersion", weeks.future, { origin: "google_reconciliation",
      google_reconciliation_source_publication_id: ids.base, google_reconciliation_fingerprint: "a".repeat(64), activation_mode: "immediate",
      base_publication_id: ids.base, base_publication_revision: 1 });
    return publication("automatic", v, weeks.future, { attempt_generation: 1, write_journal_version: 1, activation_mode: "immediate",
      effective_at: new Date(clock() + (expired ? -60_000 : 600_000)), sync_state: "delayed", last_error_class: "provider_unavailable" });
  }
  async function seed(name) {
    if (["initial", "explicit-empty"].includes(name)) return;
    if (name === "empty-replaced-future") {
      const current = await version("baseVersion", weeks.current);
      const future = await version("futureVersion", weeks.future);
      const laterWeek = civilDay(weeks.future, 7);
      const later = await version("laterVersion", laterWeek);
      const activation = (await database.query("select $1::date::timestamp at time zone 'Europe/Berlin' as value", [weeks.future])).rows[0].value;
      await publication("later", later, laterWeek, { ...confirmed, publication_revision: 3 });
      await publication("emptyFuture", future, weeks.future, { ...confirmed, windows: "[]", publication_revision: 2,
        effective_at: activation, effective_until: activation, effective_to: weeks.beforeFuture, superseded_by_publication_id: ids.later });
      await publication("base", current, weeks.current, { ...confirmed, publication_revision: 1, activation_mode: "immediate", effective_at: new Date(clock() - 600_000), effective_until: activation,
        effective_to: weeks.beforeFuture, superseded_by_publication_id: ids.emptyFuture });
      return;
    }
    if (name.startsWith("calendar-")) {
      const h = await version("historyVersion", historyWeek);
      const c = await version("baseVersion", weeks.current);
      if (name === "calendar-history-only") {
        await publication("inactive", c, weeks.current, { ...confirmed, status: "inactive", windows: "[]", deactivated_at: new Date(clock()), deactivation_reason: "manual_disconnect", publication_revision: 2 });
        await publication("history", h, historyWeek, { ...confirmed, effective_to: beforeCurrent, superseded_by_publication_id: ids.inactive, publication_revision: 1 });
        return;
      }
      const f = await version("futureVersion", weeks.future);
      await publication("future", f, weeks.future, { ...confirmed, publication_revision: 3, windows: JSON.stringify([{ weekday: 1, startMinute: 660, endMinute: 840 }]) });
      await publication("base", c, weeks.current, { ...confirmed, effective_to: weeks.beforeFuture, superseded_by_publication_id: ids.future, publication_revision: 2 });
      await publication("history", h, historyWeek, { ...confirmed, effective_to: beforeCurrent, superseded_by_publication_id: ids.base, publication_revision: 1 });
      if (name === "calendar-exclusion") {
        await draft({ selected_week_start: weeks.future, base_publication_id: ids.future, base_publication_revision: 3 });
        const p = await version("preparingVersion", weeks.future, { selected_week_start: weeks.future, base_publication_id: ids.future, base_publication_revision: 3 });
        await publication("pending", p, weeks.future);
      }
      return;
    }
    if (name === "draft") { await draft(); return; }
    if (name.startsWith("preparing") || name.startsWith("recovery")) {
      const v = await draft();
      await publication("pending", v, weeks.future, { attempt_generation: 1, write_journal_version: 1,
        effective_at: new Date(clock() + (name === "recovery-expired" ? -60_000 : 600_000)),
        ...(name === "recovery-restarted" ? { restart_requested_at: new Date(clock()) } : {}),
        ...(name === "recovery-identity" ? { last_error_class: "provider_identity_mismatch", sync_state: "delayed" } : {}) });
      return;
    }
    if (name === "published") { const v = await draft(); await publication("publishedDraft", v, weeks.future, confirmed); return; }
    if (name.startsWith("automatic")) {
      await base();
      if (name.includes("private")) await draft();
      if (name.includes("history")) { const v = await draft(); await publication("publishedDraft", v, weeks.future, { ...confirmed, publication_revision: 2 }); }
      await automatic(); return;
    }
    if (name === "conflict") {
      await base(); const d = await draft();
      const resolution = await version("resolution", weeks.future, { origin: "google_reconciliation", google_reconciliation_source_publication_id: ids.base,
        google_reconciliation_fingerprint: "b".repeat(64), activation_mode: "immediate", base_publication_id: ids.base, base_publication_revision: 1 });
      await publication("resolutionPublication", resolution, weeks.future);
      const c = await insert("team_workweek_google_conflicts", { id: randomUUID(), owner_profile_id: owner, base_publication_id: ids.base,
        base_publication_revision: 1, founderops_version_id: d, google_effective_from: weeks.future, google_windows: "[]", google_observations: "[]",
        google_fingerprint: "c".repeat(64), founderops_fingerprint: "d".repeat(64), state: "resolving", decision: "google", resolution_version_id: resolution, observed_at: new Date(clock()) });
      conflicts.push(c.id); return;
    }
    if (["current-future", "selected-future", "pinned", "pinned-current", "timestamped"].includes(name)) {
      const current = await version("baseVersion", weeks.current);
      const future = await version("futureVersion", weeks.future);
      await publication("future", future, weeks.future, { ...confirmed, publication_revision: 2 });
      const activation = (await database.query("select $1::date::timestamp at time zone 'Europe/Berlin' as value", [weeks.future])).rows[0].value;
      await publication("base", current, weeks.current, { ...confirmed, publication_revision: 1, effective_to: weeks.beforeFuture, superseded_by_publication_id: ids.future,
        ...(name === "timestamped" ? { activation_mode: "immediate", effective_at: new Date(clock() - 600_000), effective_until: activation } : {}) });
      if (name === "selected-future" || name.startsWith("pinned")) {
        if (name.startsWith("pinned")) {
          const s = await insert("team_workweek_google_series", { id: randomUUID(), publication_id: ids.future, source_window_id: ids.futureVersionWindow,
            owner_profile_id: owner, google_event_id: `fops${randomUUID().replaceAll("-", "").replace(/[w-z]/g, "a")}`, state: "confirmed", confirmed_etag: "first",
            confirmed_founderops_revision: 2, last_confirmed_at: new Date(clock()) });
          series.push(s.id);
        }
        await draft(name === "pinned-current" ? { activation_mode: "immediate", base_publication_id: ids.base, base_publication_revision: 1 }
          : { selected_week_start: weeks.future, base_publication_id: ids.future, base_publication_revision: 2 });
        if (name.startsWith("pinned")) await database.query("update public.team_workweek_google_series set confirmed_etag='rotated' where id=$1", [series[0]]);
      }
      return;
    }
    throw new Error(`Unknown workweek read fixture: ${name}`);
  }
  async function cleanup() {
    await database.query("delete from public.team_workweek_google_conflicts where id=any($1::uuid[])", [conflicts]);
    await database.query("delete from public.team_workweek_google_series where id=any($1::uuid[])", [series]);
    // Remove dependent automatic/resolution publications and versions before their base.
    async function removeUnreferencedVersions() {
      await database.query("delete from public.team_workweek_versions where id=any($1::uuid[]) and not exists(select 1 from public.team_workweek_publications p where p.source_version_id=team_workweek_versions.id)", [versions]);
    }
    for (const id of [...publications].reverse()) {
      await removeUnreferencedVersions();
      await database.query("delete from public.team_workweek_publications where id=$1", [id]);
      await removeUnreferencedVersions();
    }
    await database.query("delete from public.team_workweek_versions where id=any($1::uuid[])", [versions]);
  }
  return { seed, cleanup, ids, window };
}
