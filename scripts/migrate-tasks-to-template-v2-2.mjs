import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const TEMPLATE_VERSION = "founder-deliverable-v2.2";

function parseEnvLine(line) {
  const trimmed = line.trim().replace(/^\uFEFF/, "");
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator < 0) return null;
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  return [key, value];
}

async function loadEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const envFile = await readFile(envPath, "utf8");
  for (const pair of envFile.split(/\r?\n/).map(parseEnvLine)) {
    if (!pair) continue;
    const [key, value] = pair;
    process.env[key] ||= value;
  }
}

await loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const initiativeUpdates = [
  {
    id: "GC1",
    title: "MVP, Legal & Compliance Readiness",
    goal: "findmydoc kann mit belastbarem MVP, korrekten Rechtstexten, geklärten Claims und sauberen technischen Grundlagen sicher weiter genutzt werden.",
    milestone_id: "milestone-legal-mvp",
    priority: "P0",
    sort_order: 10,
    status: "active",
    success_criteria: "MVP-kritische Website-, Legal-, IP- und Compliance-Fragen sind geklärt, dokumentiert und für Review oder Go-Live nachvollziehbar.",
    scope_constraints: "Keine ungeprüften medizinischen Claims, keine produktive Veröffentlichung rechtlich unsicherer Inhalte und keine technischen Trust-Elemente ohne Nachweis.",
  },
  {
    id: "GC2",
    title: "Klinikpipeline, Prospecting & Outreach",
    goal: "Klinikdaten, Outreach-Sequenzen, Messekontakte und CRM-Regeln werden so vorbereitet, dass Anil, Youssef und Volkan die Klinikpipeline operativ steuern können.",
    milestone_id: "milestone-clinic-pipeline",
    priority: "P0",
    sort_order: 20,
    status: "active",
    success_criteria: "Prospects, Outreach-Regeln, Aktivierungslogik, Messeablauf und Follow-up-Nachweise sind nachvollziehbar, ownerbar und sprintfähig.",
    scope_constraints: "Daten bleiben interne Priorisierungs- und Outreach-Hilfen; keine ungeprüften Qualitätsaussagen über Kliniken und keine externen Versprechen ohne Freigabe.",
  },
  {
    id: "GC3",
    title: "Investor, Funding & Company Narrative",
    goal: "Funding Narrative, Pitchdeck, Investor-Kommunikation und Malta-/Summit-Follow-ups werden entscheidungs- und versandfähig.",
    milestone_id: "milestone-founder-ops",
    priority: "P1",
    sort_order: 30,
    status: "active",
    success_criteria: "Investor- und Funding-Artefakte enthalten klare Narrative, belegbare Claims, Empfänger-/Statuslisten und nächste Schritte.",
    scope_constraints: "Keine unbelegten Investor- oder Funding-Zusagen; externe Kommunikation bleibt reviewpflichtig, wenn Claims, Zahlen oder Rechtsfragen betroffen sind.",
  },
  {
    id: "GC4",
    title: "FounderOps, Governance & Operating System",
    goal: "Teamzugänge, Notion-/Dokumentenstruktur, Kosten, Decision Governance, Deployment und operative Transparenz sind so organisiert, dass FounderOps ohne Einzelpersonenrisiko funktioniert.",
    milestone_id: "milestone-founder-ops",
    priority: "P0",
    sort_order: 40,
    status: "active",
    success_criteria: "Betriebsrelevante Prozesse, Zugänge, Entscheidungsnachweise, Kosten, Deployment-Pipeline und Arbeitsrhythmus sind dokumentiert und reviewbar.",
    scope_constraints: "Keine Secrets in Aufgaben, GitHub oder Notion; sensible Founder-Reviews bleiben privat, bis Volkan explizit eine Veröffentlichung freigibt.",
  },
  {
    id: "GC5",
    title: "Content, Market Intelligence & Positioning",
    goal: "Content, SEO, Wettbewerbsanalyse, Förderprogramme und Marktpositionierung werden als belastbare Grundlage für Website, Blog, Investor Story und Produktpriorisierung vorbereitet.",
    milestone_id: "milestone-founder-ops",
    priority: "P1",
    sort_order: 50,
    status: "active",
    success_criteria: "Content- und Research-Artefakte sind verständlich, claim-sicher, priorisiert und mit klarer Verwendung für Produkt, Marketing oder Funding dokumentiert.",
    scope_constraints: "Keine medizinischen Qualitätsversprechen, keine ungeprüften externen Aussagen und keine Scope-Ausweitung in Produktumsetzung ohne separate Aufgabe.",
  },
];

const packageToMilestone = new Map(initiativeUpdates.map((initiative) => [initiative.id, initiative.milestone_id]));

const explicitInitiative = new Map([
  ["ozen-content-claim-guardrails-definieren", "GC1"],
  ["anil-klinik-stakeholder-bereinigen-und-p0-markieren", "GC2"],
  ["sebastian-bookimed-crawler-daten-als-notion-csv-prospect-liste-bereitstellen", "GC2"],
  ["volkan-loi-light-strategie-entscheiden", "GC2"],
  ["youssef-outreach-sequenz-fur-warme-kontakte-graue-prospects-finalisieren", "GC2"],
  ["sebastian-bookimed-prospects-mit-qualitats-und-relevanzsignalen-erweitern", "GC2"],
  ["volkan-aktivierungsregel-fur-alle-warmen-klinik-messekontakte-freigeben", "GC2"],
  ["youssef-englische-klinik-setter-outreach-welle-starten", "GC2"],
  ["anil-crm-regel-fur-graue-prospects-anlegen", "GC2"],
  ["ozen-website-legal-go-live-check-vorbereiten", "GC1"],
  ["sebastian-contact-404-beheben-oder-links-umstellen", "GC1"],
  ["youssef-partner-landing-copy-und-trust-claims-reviewen", "GC1"],
  ["ozen-privacy-policy-und-imprint-platzhalter-ersetzen-lassen", "GC1"],
  ["anil-investorendatenbank-felder-und-ansicht-in-notion-definieren", "GC3"],
  ["anil-clinic-onboarding-checkliste-erstellen", "GC2"],
  ["sebastian-register-clinic-submission-prufen", "GC1"],
  ["ozen-loi-und-graue-prospect-nutzung-zur-legal-prufung-vorbereiten", "GC1"],
  ["sebastian-clinic-contact-form-submission-prufen", "GC1"],
  ["youssef-website-texte-seo-und-wording-review-erstellen", "GC5"],
  ["volkan-gtm-prioritaten-freigeben", "GC5"],
  ["ozen-prospecting-crawler-daten-do-don-t-liste-vorbereiten", "GC1"],
  ["sebastian-website-fur-echte-klinik-onboardings-verifizieren", "GC1"],
  ["anil-documents-register-in-notion-anlegen", "GC4"],
  ["ozen-founder-ip-marke-anwalt-briefing-vorbereiten", "GC1"],
  ["anil-dusseldorf-expo-outreach-und-meetingplan-erstellen", "GC2"],
  ["sebastian-map-interaktion-auf-klinikdetailseite-fixen", "GC1"],
  ["volkan-warme-kontakte-nach-aktivierungswelle-anschreiben-ubergeben", "GC2"],
  ["anil-curemeabroad-feature-audit-erstellen", "GC5"],
  ["ozen-malta-uk-deutschland-advisor-fragen-bundeln", "GC1"],
  ["volkan-schlanke-notion-struktur-und-de-en-dokumentenregel-freigeben", "GC4"],
  ["sebastian-seed-preview-daten-sichtbar-und-intern-kennzeichnen", "GC1"],
  ["sebastian-unbelegte-trust-elemente-technisch-entfernen-oder-als-preview-markieren", "GC1"],
  ["anil-content-dokumentenregister-fur-blog-pflegen", "GC4"],
  ["sebastian-clinic-profile-minimal-schema-finalisieren", "GC1"],
  ["anil-follow-up-disziplin-sicherstellen", "GC2"],
  ["youssef-blog-briefs-fur-erste-6-artikel-erstellen", "GC5"],
  ["youssef-expo-materialien-vorbereiten", "GC2"],
  ["sebastian-event-tracking-mvp-definieren", "GC1"],
  ["sebastian-blog-veroffentlichungsflow-prufen", "GC5"],
  ["volkan-dusseldorf-expo-ziel-und-closing-regel-freigeben", "GC2"],
  ["sebastian-feature-gap-aus-konkurrenzanalyse-priorisieren", "GC5"],
  ["ozen-consent-aware-tracking-stufen-und-datenumfang-fachlich-festlegen", "GC1"],
  ["volkan-funding-narrative-zweistufig-festlegen", "GC3"],
  ["volkan-ceo-briefing-fur-pitchdeck-v2-liefern", "GC3"],
  ["youssef-pitchdeck-v2-ownern-und-umsetzen", "GC3"],
  ["youssef-malta-enterprise-versandpaket-vorbereiten", "GC3"],
  ["volkan-malta-enterprise-anfrage-senden", "GC3"],
  ["volkan-summit-investorenstatus-aktualisieren", "GC3"],
  ["volkan-summit-follow-ups-vorbereiten-und-senden", "GC3"],
  ["youssef-investor-e-mails-reviewen-und-template-erstellen", "GC3"],
  ["youssef-linkedin-founder-update-vorbereiten", "GC3"],
  ["anil-startup-forderprogramme-und-cloud-credits-datenbank-erstellen", "GC3"],
  ["sebastian-domain-registrar-buendelung-und-umzug-recherchieren", "GC4"],
  ["volkan-splitwise-kosten-sauberziehen-mpmzhs4n", "GC4"],
  ["volkan-gemeinsame-kostenverwaltung-nach-splitwise-kl-ren-mpmzhs4n", "GC4"],
  ["volkan-passwortmanager-teamzugaenge-auswaehlen-mpor2l3j", "GC4"],
  ["volkan-crm-system-fur-klinikpipeline-auswahlen-oder-mvp-planen-867a54ac", "GC2"],
  ["youssef-telefonie-voip-losung-fur-turkei-outreach-auswahlen-6763d909", "GC2"],
  ["sebastian-vercel-deployment-pipeline-fuer-fmd-planning-aufsetzen-mpppubzf", "GC4"],
  ["sebastian-founderops-wsl-pipeline-f-r-lokale-nutzung-bereitstellen-mpvj546m", "GC4"],
]);

const taskOverrides = {
  "volkan-passwortmanager-teamzugaenge-auswaehlen-mpor2l3j": {
    problem_statement: "Der Zugriff auf kritische Accounts ist anfällig, wenn 2FA-Geräte, Recovery-Codes oder einzelne Admins nicht verfügbar sind. Dadurch hängen Deployment, GitHub-Zugriff und operative Kontinuität zu stark an einzelnen Personen.",
    intended_outcome: "Eine klare Empfehlung für einen Team-Passwortmanager liegt vor, inklusive Kosten, Sicherheitsfunktionen, Rollenmodell, 2FA-/Passkey-Fähigkeit, Recovery-Prozess und Migrationsplan.",
    scope_constraints: "Vergleichen statt sofort migrieren. Keine bestehenden Passwörter, Recovery-Codes oder Secrets in die Aufgabe schreiben. Keine Account-Änderungen ohne separate Freigabe.",
    acceptance_criteria: "- Mindestens drei geeignete Tools wurden anhand derselben Kriterien verglichen.\n- Passkeys, TOTP/Auth-Codes, Rollen/Collections, Notfallzugriff, Audit-Log, Gerätefreigabe, Browser-Integration, Export/Backup und Kosten sind bewertet.\n- Eine Empfehlung mit Begründung, Risiken und nächstem Schritt liegt vor.",
    evidence_required: "Notion- oder Decision-Log-Link mit Vergleichstabelle, Empfehlung und offenem Risiko.",
    definition_of_done: "Volkan kann auf Basis der Vorlage entscheiden, welches Tool eingeführt wird und wie die Migration ohne Secret-Leak erfolgt.",
  },
  "volkan-markenrechte-risiko-und-losungsbericht-findmydoc-erstellen": {
    problem_statement: "Die findmydoc-Marke wurde nur auf Anne angemeldet, obwohl der Markenname aus Youssefs damaligem Umfeld kam und zwischen Anne und Youssef Misstrauen besteht. Dadurch entsteht ein möglicher Hebel gegen das Team, weil unklar ist, welche rechtlichen und operativen Folgen die alleinige Markeninhaberschaft hat.",
    intended_outcome: "Ein rechtlich nachvollziehbarer Risiko- und Lösungsbericht liegt vor: aktuelle Markeninhaberschaft, Risiken für Founder und Firma, Optionen zur Übertragung oder gemeinsamen Absicherung, Vorgehen bei Verweigerung und empfohlener nächster Schritt.",
    scope_constraints: "Keine Eskalation oder externe Kommunikation ohne Freigabe. Rechtliche Bewertung sauber von persönlichen Konflikten trennen. Investorenauswirkungen nur als Risikoaspekt aufnehmen, nicht als Hauptnarrativ.",
    acceptance_criteria: "- Der aktuelle Markenstand und die alleinige Inhaberschaft sind nachvollziehbar beschrieben.\n- Risiken für Youssef, das Founder-Team, die spätere Firma und externe Finanzierung sind getrennt bewertet.\n- Übertragungs-, Lizenz-, Mitinhaber- oder Neuanmeldungsoptionen sind mit Vor- und Nachteilen dokumentiert.\n- Ein Szenario ist beschrieben, falls Anne eine Übertragung oder Absicherung nicht mitträgt.\n- Eine klare Empfehlung mit nächstem Schritt und offenen Rechtsfragen liegt vor.",
    evidence_required: "Notion-/Drive-Link mit Bericht, Quellen, Optionen, Risikoabwägung und empfohlener Entscheidung.",
    definition_of_done: "Volkan und Youssef können auf Basis des Berichts entscheiden, welche Marken-/IP-Absicherung als nächstes rechtlich oder kommunikativ verfolgt wird.",
  },
  "volkan-founder-output-impact-bericht-bis-biweekly-erstellen": {
    problem_statement: "Im Team gibt es wiederkehrende Vorwürfe, dass einzelne Founder zu wenig greifbaren Output liefern. Youssef fühlt sich dadurch unfair bewertet und möchte den historischen Output und den tatsächlichen Impact aller Founder nachvollziehbar sehen, ohne dass der Bericht angreifend formuliert ist.",
    intended_outcome: "Ein sachlicher Founder Output & Impact Bericht liegt vor, der historische Beiträge, konkrete Ergebnisse, Wirkung, offene Lücken und belastbare nächste Schritte bis zum Biweekly transparent macht.",
    scope_constraints: "Keine persönlichen Angriffe und keine privaten Konfliktbewertungen im geteilten Bericht. Fakten, Artefakte, nachweisbare Wirkung und offene Fragen trennen. Sensible Analysen bleiben privat, bis Volkan eine Freigabe gibt.",
    acceptance_criteria: "- Relevante Outputs der Founder sind mit Zeitraum, Artefakt, Owner und Wirkung zusammengetragen.\n- Impact wird sachlich beschrieben und von bloßer Aktivität getrennt.\n- Offene Lücken, unklare Beiträge oder fehlende Nachweise sind neutral markiert.\n- Der Bericht ist für das Biweekly nutzbar, ohne einzelne Personen unnötig anzugreifen.\n- Eine kurze Management-Zusammenfassung mit nächstem Schritt liegt vor.",
    evidence_required: "Privater Arbeitslink oder freigegebener Notion-/Drive-Link mit Bericht, Quellen und Management-Zusammenfassung.",
    definition_of_done: "Volkan kann im Biweekly sachlich erklären, welcher Founder welchen Output und welchen Impact geliefert hat und welche Punkte noch geklärt werden müssen.",
  },
};

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensurePeriod(value) {
  const text = clean(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function firstSentence(value) {
  const text = clean(value).replace(/\s+/g, " ");
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])\s/);
  return match ? match[1] : text;
}

function compact(value, max = 850) {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function includesAny(text, terms) {
  const lower = `${text}`.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function inferInitiative(task) {
  if (explicitInitiative.has(task.id)) return explicitInitiative.get(task.id);
  const haystack = `${task.title} ${task.workstream} ${task.description}`;
  if (includesAny(haystack, ["legal", "marke", "privacy", "imprint", "consent", "claim", "advisor", "anwalt", "compliance"])) return "GC1";
  if (includesAny(haystack, ["bookimed", "klinik", "clinic", "outreach", "expo", "prospect", "setter", "kontakt", "telefonie", "voip", "crm-system"])) return "GC2";
  if (includesAny(haystack, ["funding", "investor", "pitchdeck", "malta enterprise", "summit", "linkedin"])) return "GC3";
  if (includesAny(haystack, ["notion", "documents", "register", "founder output", "splitwise", "kosten", "domain", "passwort", "vercel", "deployment", "pipeline", "governance", "company ops"])) return "GC4";
  if (includesAny(haystack, ["content", "blog", "seo", "wording", "marketing", "curemeabroad", "feature-gap", "förderprogramme", "cloud-credits", "competitive", "konkurrenz"])) return "GC5";
  return "GC1";
}

function evidenceLabel(task) {
  const haystack = `${task.title} ${task.workstream}`.toLowerCase();
  if (includesAny(haystack, ["mvp", "website", "crawler", "404", "map", "register clinic", "submission", "tracking", "seed"])) {
    return "GitHub-Link, PR, Screenshot oder kurzer Testnachweis, der Umsetzung und Prüfung belegt.";
  }
  if (includesAny(haystack, ["legal", "marke", "privacy", "imprint", "consent", "claim", "advisor", "loi"])) {
    return "Notion-/Drive-Link oder Decision-Log-Verweis mit Quellen, Risiken, offenen Punkten und empfohlener Entscheidung.";
  }
  if (includesAny(haystack, ["investor", "funding", "pitchdeck", "malta", "summit", "linkedin"])) {
    return "Notion-/CRM-Link, Versandnachweis oder Review-Dokument mit Empfängern, Status, nächstem Schritt und Owner.";
  }
  if (includesAny(haystack, ["klinik", "clinic", "outreach", "expo", "prospect", "telefonie", "voip", "crm"])) {
    return "CRM-/Pipeline-Link, Kontaktliste oder Versand-/Call-Nachweis mit dokumentiertem Ergebnis und nächstem Schritt.";
  }
  if (includesAny(haystack, ["content", "blog", "seo", "marketing", "copy", "wording"])) {
    return "Notion-/Drive-Link mit finalem Draft, Review-Kommentaren oder konkreter Änderungsliste.";
  }
  return "Notion-, Drive-, GitHub- oder CRM-Link mit kurzem Ergebnisnachweis, der zeigt, dass die Aufgabe reviewbar abgeschlossen wurde.";
}

function defaultProblem(task, initiativeTitle) {
  const existing = clean(task.problem_statement);
  if (existing) return existing;
  const description = firstSentence(task.description);
  if (description) {
    return compact(`${description} Ohne klare Einordnung in die Initiative "${initiativeTitle}" bleibt unklar, welches Problem die Aufgabe löst und wie der Fortschritt bewertet werden soll.`);
  }
  return `Für "${task.title}" fehlt ohne klare Aufgabenstruktur ein nachvollziehbarer Problemkontext. Dadurch kann der Owner schwerer entscheiden, welches Ergebnis wirklich zählt und welche Nachweise für den Review nötig sind.`;
}

function defaultOutcome(task) {
  const existing = clean(task.intended_outcome);
  if (existing) return existing;
  const done = firstSentence(task.definition_of_done);
  if (done) return ensurePeriod(done);
  return `Ein prüfbares Ergebnis zu "${task.title}" liegt vor und kann ohne Rückfrage im Sprint-Review bewertet werden.`;
}

function defaultScope(task) {
  const existing = clean(task.scope_constraints);
  if (existing) return existing;
  const context = firstSentence(task.description) || `die Aufgabe "${task.title}"`;
  return [
    `Gehört dazu: ${ensurePeriod(context)}`,
    "Offene Annahmen, Risiken, Blocker und Anschlussaufgaben werden direkt in der Aufgabe oder im verlinkten Nachweis festgehalten.",
    "Nicht dazu gehört: Scope-Ausweitung, neue strategische Entscheidungen oder externe Kommunikation ohne separate Freigabe.",
  ].join("\n");
}

function defaultAcceptance(task) {
  const existing = clean(task.acceptance_criteria);
  if (existing) return existing;
  const done = firstSentence(task.definition_of_done);
  const result = done || firstSentence(task.description) || `"${task.title}" ist nachvollziehbar erledigt`;
  return [
    `- ${ensurePeriod(result)}`,
    "- Der Arbeitsstand ist so dokumentiert, dass der Review-Owner ihn ohne Rückfrage nachvollziehen kann.",
    "- Der relevante Nachweis ist verlinkt oder als klarer nächster Nachweisschritt beschrieben.",
    "- Offene Risiken, Blocker oder Folgeaufgaben sind markiert und haben einen Owner oder nächsten Schritt.",
  ].join("\n");
}

function defaultEvidence(task) {
  const existing = clean(task.evidence_required);
  return existing || evidenceLabel(task);
}

function defaultDod(task) {
  const existing = clean(task.definition_of_done);
  if (existing) return existing;
  const outcome = firstSentence(task.intended_outcome) || firstSentence(task.description);
  return ensurePeriod(outcome || `Die Aufgabe "${task.title}" ist umgesetzt, dokumentiert und reviewbar.`);
}

function buildTaskPatch(task, initiativeTitle) {
  const package_id = inferInitiative(task);
  const patch = {
    package_id,
    milestone_id: packageToMilestone.get(package_id),
    dod_template_version: TEMPLATE_VERSION,
  };

  const override = taskOverrides[task.id] || {};
  patch.problem_statement = override.problem_statement || defaultProblem(task, initiativeTitle);
  patch.intended_outcome = override.intended_outcome || defaultOutcome(task);
  patch.scope_constraints = override.scope_constraints || defaultScope(task);
  patch.acceptance_criteria = override.acceptance_criteria || defaultAcceptance(task);
  patch.evidence_required = override.evidence_required || defaultEvidence(task);
  patch.definition_of_done = override.definition_of_done || defaultDod(task);

  if (task.github_issue_number && task.github_sync_status === "synced") {
    patch.github_sync_status = "not_synced";
    patch.github_sync_error = null;
  }

  return patch;
}

function hasSuspiciousText(value) {
  const text = clean(value);
  return /[A-Za-zÄÖÜäöüß]\?[A-Za-zÄÖÜäöüß]/.test(text) || text.includes("Ã") || text.includes("Â");
}

const { data: tasks, error: tasksError } = await supabase
  .from("tasks")
  .select("id,title,description,status,priority,owner,assignee,workstream,package_id,milestone_id,task_type,score_relevant,github_issue_number,github_sync_status,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,definition_of_done,dod_template_version")
  .order("sort_order", { ascending: true });

if (tasksError) throw tasksError;

const initiativeTitleById = new Map(initiativeUpdates.map((initiative) => [initiative.id, initiative.title]));
const taskPatches = tasks.map((task) => {
  const package_id = inferInitiative(task);
  return {
    task,
    patch: buildTaskPatch(task, initiativeTitleById.get(package_id)),
  };
});

const suspicious = [];
for (const initiative of initiativeUpdates) {
  for (const [field, value] of Object.entries(initiative)) {
    if (hasSuspiciousText(value)) suspicious.push({ table: "packages", id: initiative.id, field, value });
  }
}
for (const { task, patch } of taskPatches) {
  for (const [field, value] of Object.entries(patch)) {
    if (typeof value === "string" && hasSuspiciousText(value)) suspicious.push({ table: "tasks", id: task.id, field, value });
  }
}

if (suspicious.length) {
  console.error("Refusing to write suspicious text:");
  console.error(JSON.stringify(suspicious, null, 2));
  process.exit(1);
}

const changedTasks = taskPatches.filter(({ task, patch }) =>
  Object.entries(patch).some(([key, value]) => task[key] !== value),
);

const summary = {
  mode: APPLY ? "apply" : "dry-run",
  templateVersion: TEMPLATE_VERSION,
  initiativesToUpdate: initiativeUpdates.length,
  totalTasks: tasks.length,
  tasksToUpdate: changedTasks.length,
  taskTypes: tasks.reduce((acc, task) => {
    acc[task.task_type || "none"] = (acc[task.task_type || "none"] || 0) + 1;
    return acc;
  }, {}),
  targetInitiatives: changedTasks.reduce((acc, { patch }) => {
    acc[patch.package_id] = (acc[patch.package_id] || 0) + 1;
    return acc;
  }, {}),
  sample: changedTasks.slice(0, 8).map(({ task, patch }) => ({
    id: task.id,
    title: task.title,
    packageFrom: task.package_id,
    packageTo: patch.package_id,
    milestoneFrom: task.milestone_id,
    milestoneTo: patch.milestone_id,
    githubSyncFrom: task.github_sync_status,
    githubSyncTo: patch.github_sync_status || task.github_sync_status,
  })),
};

console.log(JSON.stringify(summary, null, 2));

if (!APPLY) {
  console.log("Dry-run only. Run `node scripts/migrate-tasks-to-template-v2-2.mjs --apply` to write changes.");
  process.exit(0);
}

await mkdir(resolve(process.cwd(), "docs"), { recursive: true });
const backupPath = resolve(
  process.cwd(),
  "docs",
  `task-template-v2-2-migration-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
await writeFile(backupPath, JSON.stringify({ tasks, initiativeUpdates }, null, 2), "utf8");

for (const initiative of initiativeUpdates) {
  const { error } = await supabase.from("packages").update(initiative).eq("id", initiative.id);
  if (error) throw new Error(`packages/${initiative.id}: ${error.message}`);
}

for (const { task, patch } of changedTasks) {
  const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
  if (error) throw new Error(`tasks/${task.id}: ${error.message}`);
}

console.log(`Updated ${initiativeUpdates.length} initiatives and ${changedTasks.length} tasks.`);
console.log(`Backup written to ${backupPath}`);
process.exit(0);
