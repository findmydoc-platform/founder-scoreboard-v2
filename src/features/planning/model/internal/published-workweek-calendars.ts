import { addCalendarDays, berlinDateKey, validateCalendarWorkweekRange, type CalendarTeamWorkweek } from "@/features/team-workweek/model/team-workweek-calendar";
import type { WorkweekCalendarScope, WorkweekCalendarResponse, WorkweekCalendarView } from "@/features/team-workweek/model/published-workweek-calendar-state";
import type { PlanningReadStatus } from "../planning-state";

type Day = { members: Map<string, number>; completeAt: number };
type Range = { scope: WorkweekCalendarScope; days: Map<string, Day>; status: PlanningReadStatus; error: string; coverage: WorkweekCalendarView["coverage"]; loaded: boolean; denied: boolean; savedAt: number; day: string; activation: number; invalidated: boolean; acceptedRead: number; hasCalendarRange: boolean };
const keyFor = (scope: WorkweekCalendarScope) => `${scope.policy}:${scope.from}/${scope.to}`;
function days(from: string, to: string) { const result: string[] = []; for (let date = from; date <= to; date = addCalendarDays(date, 1)) result.push(date); return result; }
function freezeView<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freezeView); Object.freeze(value); } return value; }
function overlaps(row: CalendarTeamWorkweek, date: string) { return row.effectiveFrom <= date && (!row.effectiveTo || row.effectiveTo >= date); }
export function createPublishedWorkweekCalendars(options: {
  active(): boolean; generation(): number; changed(): void; now(): number;
  read?: (scope: WorkweekCalendarScope) => Promise<WorkweekCalendarResponse>;
}) {
  const ranges = new Map<string, Range>();
  const entities = new Map<string, { row: CalendarTeamWorkweek; acceptedAt: number }>();
  const requests = new Map<string, Promise<boolean>>();
  const views = new Map<string, { fresh: boolean; value: WorkweekCalendarView }>();
  let clock = 0;
  let authority = 0;
  let invalidation = 0;
  let current: { ids: string[]; upcoming: string[]; owners?: string[]; referenceDate: string; nextActivationAt: string | null; acceptedAt: number } | undefined;
  function changed() { views.clear(); options.changed(); }
  function valid(scope: WorkweekCalendarScope) { return ["team-week", "header-month"].includes(scope.policy) && validateCalendarWorkweekRange(scope.from, scope.to).ok; }
  function collect() {
    const retained = new Set([...(current?.ids || []), ...(current?.upcoming || [])]);
    for (const range of ranges.values()) for (const day of range.days.values()) for (const id of day.members.keys()) retained.add(id);
    for (const id of entities.keys()) if (!retained.has(id)) entities.delete(id);
  }
  function rangeFor(scope: WorkweekCalendarScope) {
    const key = keyFor(scope);
    let range = ranges.get(key);
    if (!range) {
      range = { scope: { ...scope }, days: new Map(days(scope.from, scope.to).map(date => {
        const known = [...ranges.values()].filter(entry => !entry.denied).flatMap(entry => entry.days.has(date) ? [entry.days.get(date)!] : []).sort((left, right) => right.completeAt - left.completeAt)[0];
        return [date, { members: new Map(known?.members), completeAt: known?.completeAt || 0 }];
      })), status: "not-loaded", error: "", coverage: "none", loaded: false, denied: false, savedAt: 0, day: "", activation: Infinity, invalidated: false, acceptedRead: 0, hasCalendarRange: false };
      ranges.set(key, range);
      const matching = [...ranges].filter(([, entry]) => entry.scope.policy === scope.policy);
      if (matching.length > 8) { const [oldKey] = matching[0]; ranges.delete(oldKey); views.delete(oldKey); requests.delete(oldKey); collect(); }
    }
    return range;
  }
  function fresh(range: Range) { return range.loaded && !range.denied && !range.invalidated && range.day === berlinDateKey(new Date(options.now())) && options.now() - range.savedAt < 60_000 && options.now() < range.activation; }
  const rowsFor = (ids: Iterable<string>) => [...new Set(ids)].flatMap(id => entities.has(id) ? [entities.get(id)!.row] : []);
  function view(scope: WorkweekCalendarScope): WorkweekCalendarView {
    if (!valid(scope)) throw new Error("Ungültiger Kalenderbereich.");
    const active = options.active();
    const range = rangeFor(scope);
    const cacheFresh = active && fresh(range);
    const cached = views.get(keyFor(scope));
    if (cached && cached.fresh === cacheFresh) return cached.value;
    const dayValues: Record<string, CalendarTeamWorkweek[]> = {};
    const retainedRanges = scope.policy === "header-month" ? [...ranges.values()].filter(item => item.scope.policy === "header-month" && item.loaded && !item.denied) : range.loaded && !range.denied ? [range] : [];
    const perDay = new Map<string, Day>();
    for (const entry of retainedRanges) for (const [date, day] of entry.days) {
      const prior = perDay.get(date);
      if (!prior || day.completeAt > prior.completeAt) perDay.set(date, day);
    }
    for (const [date, day] of perDay) dayValues[date] = rowsFor(day.members.keys()).filter(row => overlaps(row, date));
    const hasSnapshot = active && !range.denied && (range.loaded || retainedRanges.length > 0);
    const snapshot = hasSnapshot && current ? structuredClone({ currentWorkweeks: rowsFor(current.ids), calendarWorkweeks: rowsFor(Object.values(dayValues).flat().map(row => row.id)), calendarByDay: dayValues, upcomingWorkweeks: rowsFor(current.upcoming).sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom)), publishedOwnerIds: current.owners, referenceDate: current.referenceDate, hasCalendarRange: range.hasCalendarRange, nextActivationAt: current.nextActivationAt }) : null;
    const value: WorkweekCalendarView = { scope: { ...scope }, readStatus: !active ? "not-loaded" : range.denied ? "forbidden" : range.status === "current" && !cacheFresh ? "stale" : range.status, coverage: active && !range.denied ? range.coverage : "none", freshness: cacheFresh && range.status === "current" ? "current" : "stale", cacheFresh, invalidation, acceptedRead: range.acceptedRead, error: active ? range.error : "", snapshot };
    freezeView(value);
    views.set(keyFor(scope), { fresh: cacheFresh, value });
    return value;
  }
  function withhold() {
    authority++; invalidation++; requests.clear(); entities.clear(); current = undefined;
    for (const range of ranges.values()) { range.days.forEach(day => { day.members.clear(); day.completeAt = 0; }); range.coverage = "none"; range.loaded = false; range.denied = true; range.status = "forbidden"; range.error = "Kein Zugriff auf veröffentlichte Arbeitszeiten."; range.invalidated = true; }
    changed();
  }
  function load(scope: WorkweekCalendarScope): Promise<boolean> {
    if (!options.active() || !valid(scope)) return Promise.resolve(false);
    const key = keyFor(scope);
    const pending = requests.get(key);
    if (pending) return pending;
    const range = rangeFor(scope);
    ranges.delete(key); ranges.set(key, range);
    const started = ++clock;
    const generation = options.generation();
    const audience = authority;
    range.status = "loading"; range.error = "";
    changed();
    const loading = (async () => {
      try {
        if (!options.read) throw new Error("Arbeitszeiten konnten nicht geladen werden.");
        const result = await options.read(scope);
        if (!options.active() || generation !== options.generation() || audience !== authority || ranges.get(key) !== range) return false;
        if (!Array.isArray(result.currentWorkweeks) || !result.referenceDate || scope.policy === "header-month" && !Array.isArray(result.calendarWorkweeks)) throw new Error("Arbeitszeiten konnten nicht geladen werden.");
        const incoming = result.calendarWorkweeks || result.currentWorkweeks;
        const coverage = result.calendarWorkweeks && result.calendarCoverage !== "partial" ? "complete" : "partial";
        let stale = false;
        for (const row of [...result.currentWorkweeks, ...incoming, ...result.upcomingWorkweeks || []]) {
          const previous = entities.get(row.id);
          if (previous && (previous.acceptedAt > started || previous.row.ownerProfileId !== row.ownerProfileId || previous.row.publicationRevision > row.publicationRevision)) { stale = true; continue; }
          entities.set(row.id, { row: structuredClone(row), acceptedAt: started });
        }
        for (const target of ranges.values()) {
          if (target.denied && target !== range) continue;
          for (const [date, day] of target.days) {
            if (date < scope.from || date > scope.to) continue;
            if (day.completeAt > started) { stale = true; continue; }
            const ids = new Set(incoming.filter(row => overlaps(row, date)).map(row => row.id));
            if (coverage === "complete") {
              for (const [id, acceptedAt] of day.members) if (!ids.has(id) && acceptedAt <= started) day.members.delete(id);
              day.completeAt = started;
            }
            for (const id of ids) if ((day.members.get(id) || 0) <= started) day.members.set(id, started);
          }
        }
        const activation = Math.min(...(result.workweeks || []).flatMap(row => row.effectiveAt && Date.parse(row.effectiveAt) > options.now() ? [Date.parse(row.effectiveAt)] : []));
        if (!current || current.acceptedAt <= started) current = { ids: result.currentWorkweeks.map(row => row.id), upcoming: result.upcomingWorkweeks ? result.upcomingWorkweeks.map(row => row.id) : current?.upcoming || [], owners: result.publishedOwnerIds || current?.owners, referenceDate: result.referenceDate, nextActivationAt: result.workweeks ? Number.isFinite(activation) ? new Date(activation).toISOString() : null : current?.nextActivationAt || null, acceptedAt: started };
        range.loaded = true; range.denied = false; range.coverage = coverage; range.acceptedRead = started; range.hasCalendarRange = Array.isArray(result.calendarWorkweeks); range.savedAt = options.now(); range.day = berlinDateKey(new Date(options.now())); range.activation = activation; range.invalidated = false; range.status = stale || coverage === "partial" ? "stale" : "current";
        collect(); changed(); return true;
      } catch (error) {
        if (!options.active() || generation !== options.generation() || audience !== authority || ranges.get(key) !== range) return false;
        const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
        if (status === 401 || status === 403) withhold();
        else { range.status = "unavailable"; range.error = error instanceof Error ? error.message : "Arbeitszeiten konnten nicht geladen werden."; changed(); }
        return false;
      }
    })();
    requests.set(key, loading);
    void loading.finally(() => { if (requests.get(key) === loading) requests.delete(key); });
    return loading;
  }
  return {
    publicState: { workweekCalendar: view, loadWorkweekCalendar: load },
    invalidatePublishedWorkweeks() { if (!options.active()) return; authority++; invalidation++; requests.clear(); for (const range of ranges.values()) { range.invalidated = true; if (range.loaded && !range.denied) range.status = "stale"; } changed(); },
    invalidateAuthority: withhold,
    clear() { authority++; invalidation++; requests.clear(); entities.clear(); ranges.clear(); views.clear(); current = undefined; },
  };
}
