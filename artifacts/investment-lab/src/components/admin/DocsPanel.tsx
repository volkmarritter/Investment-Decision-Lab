// DocsPanel — operator-facing documentation of the admin update flows.

import { useEffect, useState } from "react";
import {
ChevronDown,
ChevronRight,
BookOpen,
ExternalLink,
AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAdminT } from "@/lib/admin-i18n";

const STORAGE_KEY = "admin.docsPanel.open";

export interface DocsPanelGithub {
  owner: string | null;
  repo: string | null;
  baseBranch: string;
}

interface DocsPanelProps {
  github?: DocsPanelGithub;
}

// Build a github.com URL pointing at a specific file on the base branch.
// Returns null when the api-server hasn't been configured with owner/repo so
// callers can suppress the link rather than render a broken anchor.
//
// Path segments are individually URI-encoded (slashes preserved) so any
// future call site can pass paths containing spaces, `#`, `?` or unicode
// without producing a malformed URL — today's call sites are all ASCII so
// this is defensive, not a fix for a current bug.
function fileUrl(github: DocsPanelGithub | undefined, path: string): string | null {
  if (!github?.owner || !github?.repo) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${github.owner}/${github.repo}/blob/${encodeURIComponent(github.baseBranch)}/${encoded}`;
}

// Filter the repo's Pull Request list to a single flow by matching the branch prefix
// used by `openAddEtfPr` / `openAddLookthroughPoolPr` / `openUpdateAppDefaultsPr`.
// `is:pr head:add-etf/` returns every Pull Request (open + closed) whose branch starts
// with that prefix, which is exactly the operator's mental model of "all the
// Pull Requests this flow has produced".
function prListUrl(
  github: DocsPanelGithub | undefined,
  branchPrefix: string,
): string | null {
  if (!github?.owner || !github?.repo) return null;
  const q = encodeURIComponent(`is:pr head:${branchPrefix}`);
  return `https://github.com/${github.owner}/${github.repo}/pulls?q=${q}`;
}

function repoUrl(github: DocsPanelGithub | undefined): string | null {
  if (!github?.owner || !github?.repo) return null;
  return `https://github.com/${github.owner}/${github.repo}`;
}


import {
    AfterMergeCallout,
    FlowSection,
    ExternalAnchor,
  } from "./DocsPanel.parts";

  export function DocsPanel({ github }: DocsPanelProps) {
    const { lang, t } = useAdminT();

    const repo = repoUrl(github);
    const allPrsUrl = github?.owner && github?.repo
      ? `https://github.com/${github.owner}/${github.repo}/pulls`
      : null;
    const actionsUrl = github?.owner && github?.repo
      ? `https://github.com/${github.owner}/${github.repo}/actions`
      : null;
    const autoMergeRunsUrl = github?.owner && github?.repo
      ? `https://github.com/${github.owner}/${github.repo}/actions/workflows/admin-auto-merge.yml`
      : null;

    return (
      <div data-testid="card-docs-panel" className="space-y-5 text-sm">
        <p className="text-muted-foreground">
          {t({
            de: 'Diese Seite kennt sieben verschiedene Wege, Daten zu ändern. Jeder hat ein anderes Ziel, einen anderen Sichtbarkeitsbereich und eine andere Latenz, bis Endnutzer die Änderung sehen. Vor dem Klick auf „Pull request öffnen" lohnt sich ein Blick darauf, welcher Flow gerade läuft.',
            en: "This page exposes seven distinct ways to change data. Each one has a different target, scope of visibility, and latency before end users see the change. Worth a glance before clicking 'Open pull request' to confirm which flow is running.",
          })}
        </p>

        <AfterMergeCallout
          autoMergeRunsUrl={autoMergeRunsUrl}
          allPrsUrl={allPrsUrl}
        />
  
      <FlowSection
            number={1}
            testid="docs-flow-etf-catalog"
            title={t({
              de: "ETF-Katalog (Pull Request auf src/lib/etfs.ts)",
              en: "ETF catalog (Pull Request to src/lib/etfs.ts)",
            })}
            tone="emerald"
            scope={t({
              de: "Alle Nutzer nach Merge + Redeploy",
              en: "All users after merge + redeploy",
            })}
            trigger={t({
              de: '„ISIN vorschlagen" → Vorschau → „Pull Request öffnen"',
              en: "'Suggest ISIN' → Preview → 'Open Pull Request'",
            })}
            file="artifacts/investment-lab/src/lib/etfs.ts"
            fileLink={fileUrl(
              github,
              "artifacts/investment-lab/src/lib/etfs.ts",
            )}
            prListLink={prListUrl(github, "add-etf/")}
            body={
              lang === "de" ? (
                <>
                  <p>
                    Der bevorzugte Weg, einen <strong>neuen ETF</strong> in den
                    statischen Katalog zu legen oder einen{" "}
                    <strong>bestehenden Eintrag zu ersetzen</strong> (z. B.
                    Replikation gewechselt, neue ISIN nach Verschmelzung). Die
                    Felder werden aus justETF gescraped, du kannst sie vor dem
                    Pull Request noch editieren. Der Replace-vs-Add-Entscheidung wird
                    automatisch anhand des Katalog-Keys getroffen — bei
                    Doppel-ISIN wird der Submit blockiert.
                  </p>
                  <p>
                    Sichtbar ist die Änderung erst nach{" "}
                    <strong>Pull Request-Review, Merge und Redeploy</strong> — der Bundle
                    wird beim Build statisch eingelesen.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Preferred path for adding a <strong>new ETF</strong> to the
                    static catalog or <strong>replacing an existing entry</strong>{" "}
                    (e.g. replication switched, new ISIN after a merger).
                    Fields are scraped from justETF and you can edit them
                    before opening the Pull Request. The replace-vs-add decision is made
                    automatically from the catalog key — duplicate ISINs block
                    submit.
                  </p>
                  <p>
                    The change becomes visible only after{" "}
                    <strong>Pull Request review, merge and redeploy</strong> — the bundle
                    is read in statically at build time.
                  </p>
                </>
              )
            }
          />

          <Separator />

          {/* Flow 1b — batch alternatives (2026-04-28) */}
          <FlowSection
            number="1b"
            testid="docs-flow-batch-alternatives"
            title={t({
              de: "Alternativen sammelweise (ein Pull Request statt vieler)",
              en: "Batch alternatives (one Pull Request instead of many)",
            })}
            tone="emerald"
            scope={t({
              de: "Alle Nutzer nach Merge + Redeploy",
              en: "All users after merge + redeploy",
            })}
            trigger={t({
              de: '„Alternativen sammelweise hinzufügen" → Zeilen einfügen → „Vorab prüfen" → „Alle als ein Pull Request öffnen"',
              en: "'Add alternatives in batch' → paste rows → 'Preview' → 'Submit all as one Pull Request'",
            })}
            file="artifacts/investment-lab/src/lib/etfs.ts"
            fileLink={fileUrl(
              github,
              "artifacts/investment-lab/src/lib/etfs.ts",
            )}
            prListLink={prListUrl(github, "add-alt/")}
            body={
              lang === "de" ? (
                <>
                  <p>
                    Wenn mehrere kuratierte Alternativen auf einmal anstehen,
                    nutzt diese Sammel-Variante <strong>genau einen
                    Katalog-Pull Request</strong> für alle Zeilen statt einen pro ISIN.
                    Verhindert die typischen Folge-Konflikte (mehrere
                    add-alt-Branches greifen auf dieselbe Zeile in
                    <code>etfs.ts</code> zu) und macht das Review angenehmer
                    — eine Tabelle, eine Diff.
                  </p>
                  <p>
                    Format pro Zeile: <code>BucketKey ISIN [Kommentar]</code>.
                    Komma, Tab oder Whitespace sind als Trenner OK. Schon{" "}
                    <strong>beim Tippen</strong> erscheinen Warnungen pro
                    Zeile (Duplikat, Limit erreicht, Bucket fehlt) — Submit
                    bleibt so lange gesperrt, bis alle Zeilen sauber sind.
                  </p>
                  <p>
                    <strong>Vorab prüfen</strong> macht zusätzlich den
                    Scrape-Lauf und zeigt eine echte{" "}
                    <strong>grün/rot eingefärbte Diff</strong> sowohl für{" "}
                    <code>etfs.ts</code> als auch für{" "}
                    <code>lookthrough.overrides.json</code> — du siehst also
                    den exakten Änderungsumfang vor dem Pull Request. Erst bei{" "}
                    <strong>Alle als ein Pull Request öffnen</strong> wird tatsächlich
                    ein Pull Request erzeugt — zusätzlich öffnet der Server
                    best-effort einen einzelnen Look-through-Pull Request für die
                    ISINs, die noch keine Pool-Daten haben.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    When several curated alternatives are pending at once,
                    this batch variant ships <strong>exactly one catalog
                    Pull Request</strong> for every row instead of one Pull Request per ISIN.
                    Avoids the typical follow-on conflicts (multiple
                    add-alt branches racing for the same line in{" "}
                    <code>etfs.ts</code>) and makes review pleasant — one
                    table, one diff.
                  </p>
                  <p>
                    One row per line: <code>BucketKey ISIN [comment]</code>.
                    Comma, tab or whitespace are all OK as separators.
                    Per-row warnings (duplicate, cap reached, bucket missing)
                    appear <strong>as you type</strong> — Submit stays
                    disabled until every row is clean.
                  </p>
                  <p>
                    <strong>Preview</strong> additionally runs the scrape
                    pass and renders a real{" "}
                    <strong>green/red unified diff</strong> for both{" "}
                    <code>etfs.ts</code> and{" "}
                    <code>lookthrough.overrides.json</code> — you see the
                    exact change set before opening the Pull Request. Only{" "}
                    <strong>Submit all as one Pull Request</strong> actually opens
                    a Pull Request — and the server best-effort opens one
                    accompanying look-through Pull Request for the ISINs that don't
                    yet have pool data.
                  </p>
                </>
              )
            }
          />

          <Separator />

          <FlowSection
            number={2}
            testid="docs-flow-lookthrough-pool"
            title={t({
              de: "Look-through-Datenpool (Pull Request auf lookthrough.overrides.json)",
              en: "Look-through data pool (Pull Request to lookthrough.overrides.json)",
            })}
            tone="sky"
            scope={t({
              de: "Alle Nutzer nach Merge + Redeploy; danach wartet die ISIN auf den Monatsjob",
              en: "All users after merge + redeploy; afterwards the ISIN is picked up by the monthly job",
            })}
            trigger={t({
              de: '„Look-through-Datenpool" → ISIN eingeben → „Aufnehmen"',
              en: "'Look-through data pool' → enter ISIN → 'Add'",
            })}
            file="artifacts/investment-lab/src/data/lookthrough.overrides.json"
            fileLink={fileUrl(
              github,
              "artifacts/investment-lab/src/data/lookthrough.overrides.json",
            )}
            prListLink={prListUrl(github, "add-lookthrough-pool/")}
            body={
              lang === "de" ? (
                <>
                  <p>
                    Bucket-unabhängig. Macht eine ISIN für die{" "}
                    <strong>Methodology-Tausch-Ansicht</strong> verfügbar
                    (Top-10-Holdings, Länder- und Sektor-Aufteilung), auch
                    wenn der ETF gar nicht im Katalog steht. Beim Hinzufügen
                    werden die Daten einmal von justETF gescraped, der Pull Request
                    öffnet die Eintragung in der <code>pool</code>-Sektion.
                    Erst nach Merge + Redeploy ist die ISIN sowohl in der
                    Tabelle (Quelle „Auto-Refresh") als auch im
                    Methodology-Tausch ohne „No look-through data"-Hinweis
                    sichtbar.
                  </p>
                  <p>
                    Danach läuft der monatliche Refresh-Job (Flow 5) über alle
                    Pool-Einträge und hält sie automatisch aktuell.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Bucket-agnostic. Makes an ISIN available to the{" "}
                    <strong>Methodology swap view</strong> (top-10 holdings,
                    country &amp; sector breakdowns) even when the ETF is not
                    in the catalog. When you add it, the data is scraped from
                    justETF once and the Pull Request adds it to the <code>pool</code>{" "}
                    section. After merge + redeploy the ISIN appears in the
                    table (source 'Auto-Refresh') and in the Methodology swap
                    view without the 'No look-through data' warning.
                  </p>
                  <p>
                    From there on the monthly refresh job (flow 5) re-scrapes
                    every pool entry and keeps the data fresh automatically.
                  </p>
                </>
              )
            }
          />

          <Separator />

          <FlowSection
            number={3}
            testid="docs-flow-app-defaults"
            title={t({
              de: "Globale Defaults (Pull Request auf app-defaults.json)",
              en: "Global defaults (Pull Request to app-defaults.json)",
            })}
            tone="violet"
            scope={t({
              de: "Alle Nutzer nach Merge + Redeploy",
              en: "All users after merge + redeploy",
            })}
            trigger={t({
              de: '„Globale Defaults" → Werte eingeben (oder Vorlage) → „Pull Request öffnen"',
              en: "'Global defaults' → enter values (or apply preset) → 'Open Pull Request'",
            })}
            file="artifacts/investment-lab/src/data/app-defaults.json"
            fileLink={fileUrl(
              github,
              "artifacts/investment-lab/src/data/app-defaults.json",
            )}
            prListLink={prListUrl(github, "update-app-defaults/")}
            body={
              lang === "de" ? (
                <>
                  <p>
                    Schreibt risikolose Zinssätze, Home-Bias-Multiplikatoren
                    und Kapitalmarkt­annahmen (μ / σ pro Anlageklasse) als{" "}
                    <strong>neuen Default für alle Nutzer</strong>. Leere
                    Felder = Built-in-Default greift. Das Backend validiert
                    Bereiche serverseitig (gleiche Grenzen wie der
                    Methodology-Editor), bevor der Pull Request geöffnet wird.
                  </p>
                  <p>
                    Wichtig: persönliche Methodology-Overrides aus dem
                    Methodology-Tab (Flow 4) bleiben{" "}
                    <strong>oben drauf wirksam</strong>. Wer dort etwas
                    eingestellt hat, sieht weiterhin seine eigenen Werte —
                    erst „Auf Standard zurücksetzen" lässt die neuen globalen
                    Defaults greifen.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Writes risk-free rates, home-bias multipliers and capital
                    market assumptions (μ / σ per asset class) as the{" "}
                    <strong>new default for all users</strong>. Empty fields =
                    built-in default applies. The backend validates ranges
                    server-side (same bounds as the Methodology editor) before
                    opening the Pull Request.
                  </p>
                  <p>
                    Important: per-user Methodology overrides from the
                    Methodology tab (flow 4) <strong>still apply on top</strong>.
                    Anyone who set their own values continues to see them —
                    only 'Reset to default' lets the new global defaults take
                    effect for them.
                  </p>
                </>
              )
            }
          />

          <Separator />

          <FlowSection
            number={4}
            testid="docs-flow-methodology-local"
            title={t({
              de: "Persönliche Methodology-Overrides (localStorage)",
              en: "Personal Methodology overrides (localStorage)",
            })}
            tone="amber"
            scope={t({
              de: "Nur der eigene Browser, sofort wirksam, kein Pull Request",
              en: "Own browser only, instant effect, no Pull Request",
            })}
            trigger={t({
              de: 'Tab „Methodology" auf der Hauptseite → Werte ändern',
              en: "'Methodology' tab on the main page → edit values",
            })}
            file="localStorage: investment-lab.methodology.v1"
            fileLink={null}
            prListLink={null}
            body={
              lang === "de" ? (
                <>
                  <p>
                    Reine Client-Persistenz. Nichts geht zum Server, kein Pull Request
                    wird geöffnet, niemand außer dir sieht die Werte. Ideal,
                    um Szenarien durchzuspielen („was, wenn die EZB-Zinsen 1 %
                    höher liegen?") oder eine Annahme nur lokal zu setzen,
                    weil sie noch nicht reif für den globalen Default ist.
                  </p>
                  <p>
                    Im Methodology-Tab ist „Auf Standard zurücksetzen" die
                    Notbremse: ein Klick löscht den Eintrag im localStorage
                    und du landest wieder beim aktuellen globalen Default
                    (also dem zuletzt gemergten <code>app-defaults.json</code>{" "}
                    aus Flow 3).
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Pure client-side persistence. Nothing goes to the server,
                    no Pull Request is opened, nobody but you sees the values. Useful
                    for running 'what if the ECB raises rates by 1%?' style
                    scenarios, or for parking an assumption locally before
                    promoting it to the global default.
                  </p>
                  <p>
                    In the Methodology tab the 'Reset to default' button is
                    the escape hatch: one click clears the localStorage entry
                    and you fall back to whatever the current global default
                    is (i.e. the last merged <code>app-defaults.json</code>{" "}
                    from flow 3).
                  </p>
                </>
              )
            }
          />

          <Separator />

          <FlowSection
            number={5}
            testid="docs-flow-monthly-refresh"
            title={t({
              de: "Monatlicher Refresh-Job (cron, automatisiert)",
              en: "Monthly refresh job (cron, automated)",
            })}
            tone="slate"
            scope={t({
              de: "Alle Nutzer; Override-Layer wird im laufenden Betrieb aktualisiert",
              en: "All users; override layer is refreshed in production",
            })}
            trigger={t({
              de: 'Cron — keine manuelle Aktion (siehe „Datenaktualität" unten für den Zeitplan)',
              en: "Cron — no manual action (see 'Data freshness' below for the schedule)",
            })}
            file=".github/workflows/refresh-*.yml"
            fileLink={
              github?.owner && github?.repo
                ? `https://github.com/${github.owner}/${github.repo}/tree/${github.baseBranch}/.github/workflows`
                : null
            }
            prListLink={actionsUrl}
            prListLabel={{
              de: "GitHub Actions öffnen",
              en: "Open GitHub Actions",
            }}
            body={
              lang === "de" ? (
                <>
                  <p>
                    Läuft serverseitig im Hintergrund. Geht über alle ISINs im
                    Look-through-Pool (Flow 2) sowie alle Katalog-ETFs (Flow 1)
                    und scraped TER, AUM, Top-Holdings und Aufteilungen neu.
                    Ergebnis landet in den <em>Override-Layer</em>-Dateien,
                    die zur Laufzeit über den statischen Katalog gemergt
                    werden — also <strong>kein Redeploy nötig</strong>.
                  </p>
                  <p>
                    Felder, die bei einem Lauf neu sind, tauchen in der Karte
                    „Aktuelle Datenänderungen" rechts auf. Jeder Lauf wird
                    zusätzlich in „Letzte Läufe" protokolliert, inklusive
                    Fehler — wenn justETF zickt, ist das hier die erste
                    Anlaufstelle.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Runs server-side in the background. Iterates through every
                    ISIN in the look-through pool (flow 2) and every catalog
                    ETF (flow 1), re-scraping TER, AUM, top holdings and
                    breakdowns. The output lands in the{" "}
                    <em>override-layer</em> files which are merged over the
                    static catalog at runtime — meaning{" "}
                    <strong>no redeploy is required</strong>.
                  </p>
                  <p>
                    Fields that change during a run show up in the 'Recent
                    data changes' card on the right. Every run is also logged
                    under 'Recent runs', errors included — when justETF
                    misbehaves, that's the first place to look.
                  </p>
                </>
              )
            }
          />

          <Separator />

          {/* Flow 6 — workspace sync (2026-04-28) */}
          <FlowSection
            number={6}
            testid="docs-flow-workspace-sync"
            title={t({
              de: "Workspace-Sync (laufende Server-Kopie auffrischen)",
              en: "Workspace sync (refresh the running server's checkout)",
            })}
            tone="violet"
            scope={t({
              de: "Nur Admin-Pane; betrifft die Server-Kopie der Daten-Dateien zwischen Merge und Redeploy",
              en: "Admin pane only; affects the server's local copy of the data files between merge and redeploy",
            })}
            trigger={t({
              de: '„Workspace-Synchronisation" → „Aus Origin aktualisieren" (holt frischen Stand) → wenn „Hinter Origin" > 0 → „Commits ziehen"',
              en: "'Workspace sync' → 'Refresh from origin' (fetches latest) → if 'Behind origin' > 0 → 'Pull commits'",
            })}
            file="(git fetch origin main && git merge --ff-only)"
            fileLink={null}
            prListLink={null}
            body={
              lang === "de" ? (
                <>
                  <p>
                    Nach jedem Merge eines Katalog- oder Pool-Pull Requests zeigt der
                    Admin-Pane <strong>kurzzeitig veraltete Daten</strong>{" "}
                    an, weil die laufende Server-Kopie noch auf dem alten
                    Commit sitzt. Ohne Sync schlagen Folge-Aktionen
                    möglicherweise fehl (Duplikate erkennen Geister, das
                    Alternativen-Limit blockt obwohl ein Slot bereits frei ist).
                  </p>
                  <p>
                    Die Karte oben zeigt, wie viele Commits du{" "}
                    <strong>hinter Origin</strong> liegst — diese Zahl wird
                    aus dem letzten gespeicherten Origin-Stand berechnet
                    und beim Öffnen der Seite <em>nicht</em> automatisch
                    aktualisiert (das spart einen Netz-Call pro Seitenaufruf).
                    Ein Klick auf <strong>Aus Origin aktualisieren</strong>{" "}
                    holt den frischen Stand; <strong>Status neu laden</strong>
                    {" "}liest nur den lokalen Stand neu. Ein Klick auf{" "}
                    <strong>Commits ziehen</strong> macht dann ein
                    fast-forward-Merge — keine Konflikte, keine eigenen
                    Änderungen werden angefasst. Falls die Arbeitskopie
                    schmutzig oder gelockt ist oder du auf einem anderen
                    Branch sitzt, wird der Sync abgelehnt und der Grund
                    klar erklärt.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    After each catalog or pool Pull Request is merged, the admin pane{" "}
                    <strong>briefly shows stale data</strong> because the
                    running server's local checkout still points at the old
                    commit. Without sync, follow-up actions may fail
                    (duplicate checks see ghosts, the alternatives cap blocks
                    even though a slot is free again).
                  </p>
                  <p>
                    The card above shows how many commits you are{" "}
                    <strong>behind origin</strong> — this counter is
                    computed from the last cached origin ref and is{" "}
                    <em>not</em> auto-refreshed on page load (saves one
                    network call per visit). Click{" "}
                    <strong>Refresh from origin</strong> to fetch the latest;{" "}
                    <strong>Reload status</strong> only re-reads the local
                    state. Then <strong>Pull commits</strong> performs a
                    fast-forward merge — no conflicts, no local changes
                    touched. If the working copy is dirty, locked, or you
                    are on a different branch, the sync is refused with a
                    clear reason.
                  </p>
                </>
              )
            }
          />

          <Separator />

          <p className="text-xs text-muted-foreground">
            {t({
              de: 'Reihenfolge in der Praxis: Flow 1 + 1b + 2 öffnen Pull Requests (review, merge, redeploy); 1b spart einen Pull Request pro Alternative ein. Flow 3 öffnet einen Pull Request für Default-Werte. Flow 4 ist eine reine Browser-Einstellung. Flow 5 läuft automatisch. Flow 6 (Workspace-Sync) hilft direkt nach einem Merge, damit der Server die neuen Daten sieht.',
              en: "Practical order: flows 1 + 1b + 2 open Pull Requests (review, merge, redeploy); 1b saves one Pull Request per alternative. Flow 3 opens a Pull Request for default values. Flow 4 is a pure browser-only setting. Flow 5 runs on its own. Flow 6 (workspace sync) helps right after a merge so the server sees the new data.",
            })}
          </p>

          {(repo || allPrsUrl || actionsUrl) && (
            <>
              <Separator />
              <section
                className="space-y-2"
                data-testid="docs-github-shortcuts"
              >
                <h3 className="font-semibold text-sm">
                  {t({ de: "GitHub-Direktlinks", en: "GitHub shortcuts" })}
                </h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {repo && (
                    <ExternalAnchor
                      href={repo}
                      testid="link-github-repo"
                      label={t({ de: "Repository", en: "Repository" })}
                    />
                  )}
                  {allPrsUrl && (
                    <ExternalAnchor
                      href={allPrsUrl}
                      testid="link-github-all-prs"
                      label={t({ de: "Alle Pull Requests", en: "All pull requests" })}
                    />
                  )}
                  {actionsUrl && (
                    <ExternalAnchor
                      href={actionsUrl}
                      testid="link-github-actions"
                      label={t({ de: "GitHub Actions", en: "GitHub Actions" })}
                    />
                  )}
                </div>
                {!github?.owner || !github?.repo ? (
                  <p className="text-xs text-muted-foreground">
                    {t({
                      de: "Hinweis: setze GITHUB_OWNER und GITHUB_REPO auf dem api-server, damit hier echte Links erscheinen.",
                      en: "Tip: set GITHUB_OWNER and GITHUB_REPO on the api-server so real links appear here.",
                    })}
                  </p>
                ) : null}
              </section>
            </>
          )}
    </div>
  );
}
