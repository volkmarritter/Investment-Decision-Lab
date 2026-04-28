// ----------------------------------------------------------------------------
// DocsPanel — operator-facing documentation of the admin update flows.
// ----------------------------------------------------------------------------
// Single source of truth for "where do my edits actually go and when are they
// visible to other users?". Five flows are described, each in EN + DE:
//   1. ETF catalog PR  — "ISIN vorschlagen" → opens PR to src/lib/etfs.ts
//   2. Look-through pool PR — adds an ISIN to lookthrough.overrides.json
//   3. App-defaults PR — RF / Home-Bias / CMA written to app-defaults.json
//   4. Personal Methodology overrides — per-user localStorage, no PR
//   5. Monthly refresh job — cron-driven re-scrape of pool entries
//
// In addition, a short "After-merge republish" insight section captures the
// gotcha discovered on 2026-04-27: after a PR is merged on GitHub, the deploy
// snapshot served to end users is built from whatever workspace state Replit
// has at that moment. If the Republish click happens before the GitHub merge
// has synced into the workspace, the snapshot will still be pre-merge — the
// fix is to click Republish *after* the merge has landed in main.
//
// Each flow gets two GitHub deep links when the api-server is configured with
// GITHUB_OWNER + GITHUB_REPO: "View file" (the file on the base branch) and
// "Open PRs" (filter by branch-name prefix so only this flow's PRs are shown).
// The owner/repo come through the `github` prop sourced from /admin/whoami so
// the values stay in sync with the api-server's environment.
//
// Implemented as a collapsible Card to mirror BrowseBucketsPanel's pattern so
// the operator can keep it folded once familiar but always one click away.
// ----------------------------------------------------------------------------

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

// Filter the repo's PR list to a single flow by matching the branch prefix
// used by `openAddEtfPr` / `openAddLookthroughPoolPr` / `openUpdateAppDefaultsPr`.
// `is:pr head:add-etf/` returns every PR (open + closed) whose branch starts
// with that prefix, which is exactly the operator's mental model of "all the
// PRs this flow has produced".
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

export function DocsPanel({ github }: DocsPanelProps) {
  const { lang, t } = useAdminT();
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      // sessionStorage may be unavailable; preference simply doesn't persist.
    }
  }, [open]);

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
    <Card data-testid="card-docs-panel">
      <CardHeader className="py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 text-left"
          data-testid="button-toggle-docs"
        >
          <CardTitle className="text-base flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <BookOpen className="h-4 w-4" />
            {t({
              de: "So funktionieren die Update-Flows",
              en: "How the update flows work",
            })}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {open
              ? t({ de: "Verbergen", en: "Hide" })
              : t({ de: "Anzeigen", en: "Show" })}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0 space-y-5 text-sm">
          <p className="text-muted-foreground">
            {t({
              de: 'Diese Seite kennt sieben verschiedene Wege, Daten zu ändern. Jeder hat ein anderes Ziel, einen anderen Sichtbarkeitsbereich und eine andere Latenz, bis Endnutzer die Änderung sehen. Vor dem Klick auf „PR öffnen" lohnt sich ein Blick darauf, welcher Flow gerade läuft.',
              en: "This page exposes seven distinct ways to change data. Each one has a different target, scope of visibility, and latency before end users see the change. Worth a glance before clicking 'Open PR' to confirm which flow is running.",
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
              de: "ETF-Katalog (PR auf src/lib/etfs.ts)",
              en: "ETF catalog (PR to src/lib/etfs.ts)",
            })}
            tone="emerald"
            scope={t({
              de: "Alle Nutzer nach Merge + Redeploy",
              en: "All users after merge + redeploy",
            })}
            trigger={t({
              de: '„ISIN vorschlagen" → Vorschau → „PR öffnen"',
              en: "'Suggest ISIN' → Preview → 'Open PR'",
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
                    PR noch editieren. Der Replace-vs-Add-Entscheidung wird
                    automatisch anhand des Katalog-Keys getroffen — bei
                    Doppel-ISIN wird der Submit blockiert.
                  </p>
                  <p>
                    Sichtbar ist die Änderung erst nach{" "}
                    <strong>PR-Review, Merge und Redeploy</strong> — der Bundle
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
                    before opening the PR. The replace-vs-add decision is made
                    automatically from the catalog key — duplicate ISINs block
                    submit.
                  </p>
                  <p>
                    The change becomes visible only after{" "}
                    <strong>PR review, merge and redeploy</strong> — the bundle
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
              de: "Alternativen sammelweise (ein PR statt vieler)",
              en: "Batch alternatives (one PR instead of many)",
            })}
            tone="emerald"
            scope={t({
              de: "Alle Nutzer nach Merge + Redeploy",
              en: "All users after merge + redeploy",
            })}
            trigger={t({
              de: '„Alternativen sammelweise hinzufügen" → Zeilen einfügen → „Vorab prüfen" → „Alle als ein PR öffnen"',
              en: "'Add alternatives in batch' → paste rows → 'Preview' → 'Submit all as one PR'",
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
                    Katalog-PR</strong> für alle Zeilen statt einen pro ISIN.
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
                    den exakten Änderungsumfang vor dem PR. Erst bei{" "}
                    <strong>Alle als ein PR öffnen</strong> wird tatsächlich
                    ein PR erzeugt — zusätzlich öffnet der Server
                    best-effort einen einzelnen Look-through-PR für die
                    ISINs, die noch keine Pool-Daten haben.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    When several curated alternatives are pending at once,
                    this batch variant ships <strong>exactly one catalog
                    PR</strong> for every row instead of one PR per ISIN.
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
                    exact change set before opening the PR. Only{" "}
                    <strong>Submit all as one PR</strong> actually opens
                    a PR — and the server best-effort opens one
                    accompanying look-through PR for the ISINs that don't
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
              de: "Look-through-Datenpool (PR auf lookthrough.overrides.json)",
              en: "Look-through data pool (PR to lookthrough.overrides.json)",
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
                    werden die Daten einmal von justETF gescraped, der PR
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
                    justETF once and the PR adds it to the <code>pool</code>{" "}
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
              de: "Globale Defaults (PR auf app-defaults.json)",
              en: "Global defaults (PR to app-defaults.json)",
            })}
            tone="violet"
            scope={t({
              de: "Alle Nutzer nach Merge + Redeploy",
              en: "All users after merge + redeploy",
            })}
            trigger={t({
              de: '„Globale Defaults" → Werte eingeben (oder Vorlage) → „PR öffnen"',
              en: "'Global defaults' → enter values (or apply preset) → 'Open PR'",
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
                    Methodology-Editor), bevor der PR geöffnet wird.
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
                    opening the PR.
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
              de: "Nur der eigene Browser, sofort wirksam, kein PR",
              en: "Own browser only, instant effect, no PR",
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
                    Reine Client-Persistenz. Nichts geht zum Server, kein PR
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
                    no PR is opened, nobody but you sees the values. Useful
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
                    Nach jedem Merge eines Katalog- oder Pool-PRs zeigt der
                    Admin-Pane <strong>kurzzeitig veraltete Daten</strong>{" "}
                    an, weil die laufende Server-Kopie noch auf dem alten
                    Commit sitzt. Ohne Sync schlagen Folge-Aktionen
                    möglicherweise fehl (Duplikate erkennen Geister, das
                    2-Alt-Limit blockt obwohl der Slot bereits frei ist).
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
                    After each catalog or pool PR is merged, the admin pane{" "}
                    <strong>briefly shows stale data</strong> because the
                    running server's local checkout still points at the old
                    commit. Without sync, follow-up actions may fail
                    (duplicate checks see ghosts, the 2-alt cap blocks even
                    though the slot is free again).
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
              de: 'Reihenfolge in der Praxis: Flow 1 + 1b + 2 öffnen PRs (review, merge, redeploy); 1b spart einen PR pro Alternative ein. Flow 3 öffnet einen PR für Default-Werte. Flow 4 ist eine reine Browser-Einstellung. Flow 5 läuft automatisch. Flow 6 (Workspace-Sync) hilft direkt nach einem Merge, damit der Server die neuen Daten sieht.',
              en: "Practical order: flows 1 + 1b + 2 open PRs (review, merge, redeploy); 1b saves one PR per alternative. Flow 3 opens a PR for default values. Flow 4 is a pure browser-only setting. Flow 5 runs on its own. Flow 6 (workspace sync) helps right after a merge so the server sees the new data.",
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
        </CardContent>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------
// AfterMergeCallout — pipeline explainer, "from admin click to live app".
// ----------------------------------------------------------------------------
// Originally the operator manually merged each admin PR on github.com and
// then clicked Republish in Replit, racing the GitHub→workspace sync (a
// pre-merge snapshot would deploy if Republish ran first). The 2026-04-27
// auto-merge GitHub Action removes the merge step (admin-prefixed PRs are
// squash-merged automatically once mergeable). The remaining manual step is
// "wait for the workspace to pull the merge, then Republish" — or one-time
// enable Replit's "Redeploy on commit" toggle to remove that step too.
// This callout walks through all three pipeline stages so a non-developer
// operator understands which step is automatic, which they still own, and
// what to check when an expected change hasn't appeared on the live app.
// ----------------------------------------------------------------------------
interface AfterMergeCalloutProps {
  autoMergeRunsUrl: string | null;
  allPrsUrl: string | null;
}

function AfterMergeCallout({
  autoMergeRunsUrl,
  allPrsUrl,
}: AfterMergeCalloutProps) {
  const { lang, t } = useAdminT();
  return (
    <section
      className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3 space-y-3"
      data-testid="docs-after-merge-callout"
    >
      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4" />
        <h3 className="font-semibold text-sm">
          {t({
            de: "Vom Klick im Admin bis zur Live-App",
            en: "From admin click to live app",
          })}
        </h3>
      </div>

      <div className="space-y-3 text-sm text-amber-900 dark:text-amber-100">
        {lang === "de" ? (
          <p>
            Eine Änderung an Pool, ETF-Katalog oder globalen Defaults
            durchläuft <strong>drei Stationen</strong>. Die ersten zwei sind
            automatisch, die dritte erfordert (noch) einen Klick.
          </p>
        ) : (
          <p>
            A change to the pool, ETF catalog or global defaults passes through{" "}
            <strong>three stages</strong>. The first two are automatic; the
            third still needs (one) click.
          </p>
        )}

        <ol className="space-y-3 list-decimal list-inside">
          <li>
            <strong>
              {t({ de: "PR öffnen (du)", en: "Open PR (you)" })}
            </strong>
            <div className="mt-1 ml-1">
              {lang === "de" ? (
                <>
                  Klick auf „PR öffnen" / „Aufnehmen" im Admin schickt eine
                  Pull-Request-Anfrage an GitHub. Sie taucht oben in der Karte{" "}
                  „Offene Pull Requests" auf.
                </>
              ) : (
                <>
                  Clicking "Open PR" / "Add" in the admin sends a pull-request
                  to GitHub. It appears at the top in the "Open pull requests"
                  card.
                </>
              )}
              {allPrsUrl && (
                <>
                  {" "}
                  <ExternalAnchor
                    href={allPrsUrl}
                    testid="callout-link-all-prs"
                    label={t({
                      de: "PR-Liste auf GitHub",
                      en: "PR list on GitHub",
                    })}
                  />
                </>
              )}
            </div>
          </li>

          <li>
            <strong>
              {t({
                de: "Auto-Merge (~30 Sekunden, automatisch)",
                en: "Auto-merge (~30 seconds, automatic)",
              })}
            </strong>
            <div className="mt-1 ml-1">
              {lang === "de" ? (
                <>
                  Eine GitHub-Action erkennt Admin-PRs an ihrem Branch-Namen
                  (<code>add-etf/</code>, <code>add-lookthrough-pool/</code>,{" "}
                  <code>update-app-defaults/</code>, <code>backfill-</code>) und mergt sie automatisch,
                  sobald sie konfliktfrei sind. Der Branch wird danach
                  gelöscht. Wenn du einen PR <em>vor</em> dem Merge selbst
                  prüfen willst, konvertiere ihn auf GitHub in einen{" "}
                  <strong>Draft</strong> — die Action lässt Drafts in Ruhe.
                </>
              ) : (
                <>
                  A GitHub Action recognizes admin PRs by their branch name
                  (<code>add-etf/</code>, <code>add-lookthrough-pool/</code>,{" "}
                  <code>update-app-defaults/</code>, <code>backfill-</code>) and squash-merges them as
                  soon as they are conflict-free. The branch is deleted
                  afterwards. If you want to review a PR <em>before</em> it
                  merges, convert it to a <strong>Draft</strong> on GitHub —
                  the action skips drafts.
                </>
              )}
              {autoMergeRunsUrl && (
                <>
                  {" "}
                  <ExternalAnchor
                    href={autoMergeRunsUrl}
                    testid="callout-link-auto-merge-runs"
                    label={t({
                      de: "Live-Status der Action",
                      en: "Live status of the action",
                    })}
                  />
                </>
              )}
            </div>
          </li>

          <li>
            <strong>
              {t({
                de: "Workspace-Sync + Republish (du, einmalig pro Merge)",
                en: "Workspace sync + Republish (you, once per merge)",
              })}
            </strong>
            <div className="mt-1 ml-1 space-y-2">
              {lang === "de" ? (
                <>
                  <p>
                    Replit zieht den Merge automatisch von GitHub in den
                    Workspace (kann 1–2 Minuten dauern). Im{" "}
                    <strong>Files-Tab</strong> links siehst du, ob die geänderte
                    Datei (z. B. <code>lookthrough.overrides.json</code>)
                    bereits den neuen Stand zeigt. <strong>Erst dann</strong>{" "}
                    oben rechts auf <strong>„Republish"</strong> klicken — der
                    neue Live-Snapshot ist nach 1–3 Min draußen.
                  </p>
                  <p>
                    <strong>Optional, einmal einrichten:</strong> Im{" "}
                    Deployments-Tab den Schalter „Redeploy on commit"
                    einschalten. Dann macht Replit Sync + Republish vollständig
                    automatisch nach jedem Auto-Merge — du musst gar nichts
                    mehr klicken.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Replit pulls the merge from GitHub into the workspace
                    automatically (can take 1–2 minutes). In the{" "}
                    <strong>Files tab</strong> on the left you can see whether
                    the changed file (e.g. <code>lookthrough.overrides.json</code>)
                    already reflects the new state. <strong>Only then</strong>{" "}
                    click <strong>"Republish"</strong> at the top right — the
                    new live snapshot is out in 1–3 minutes.
                  </p>
                  <p>
                    <strong>Optional, one-time setup:</strong> In the
                    Deployments tab toggle "Redeploy on commit" on. Then Replit
                    handles sync + republish fully automatically after every
                    auto-merge — no clicks needed.
                  </p>
                </>
              )}
            </div>
          </li>
        </ol>

        <div className="rounded border border-amber-400 bg-amber-100 dark:bg-amber-900/40 px-2 py-1.5 text-xs">
          {lang === "de" ? (
            <>
              <strong>Häufiger Fehler:</strong> „Republish" klicken,{" "}
              <em>bevor</em> der Workspace die Änderung gezogen hat. Folge:
              alter Stand wird ausgeliefert, obwohl der PR gemergt ist. Im
              Files-Tab kontrollieren, ob die Datei aktuell ist —{" "}
              <strong>dann</strong> erst Republish.
            </>
          ) : (
            <>
              <strong>Common mistake:</strong> Clicking "Republish"{" "}
              <em>before</em> the workspace has pulled the change. Result: the
              old state ships even though the PR is merged. Verify in the
              Files tab that the file is up to date —{" "}
              <strong>then</strong> Republish.
            </>
          )}
        </div>

        {lang === "de" ? (
          <p className="text-xs">
            Betrifft alle bundle-getragenen Daten (Flows 1, 2, 3 unten). Flow 5
            (monatlicher Job) ist davon unberührt — die Override-Layer-Dateien
            werden zur Laufzeit gelesen, kein Republish nötig.
          </p>
        ) : (
          <p className="text-xs">
            Applies to every bundle-carried payload (flows 1, 2, 3 below). Flow
            5 (monthly job) is unaffected — its override-layer files are read
            at runtime, no republish needed.
          </p>
        )}
      </div>
    </section>
  );
}

function FlowSection({
  number,
  testid,
  title,
  tone,
  scope,
  trigger,
  file,
  fileLink,
  prListLink,
  prListLabel,
  body,
}: {
  number: number | string;
  testid: string;
  title: string;
  tone: "emerald" | "sky" | "violet" | "amber" | "slate";
  scope: string;
  trigger: string;
  file: string;
  fileLink: string | null;
  prListLink: string | null;
  // Optional override label for the second link — flow 5 uses "Open GitHub
  // Actions" instead of "Open PRs" because there are no PRs for the cron job.
  prListLabel?: { de: string; en: string };
  body: React.ReactNode;
}) {
  const { t } = useAdminT();
  const toneClass = {
    emerald: "border-emerald-600 text-emerald-700 dark:text-emerald-400",
    sky: "border-sky-600 text-sky-700 dark:text-sky-400",
    violet: "border-violet-600 text-violet-700 dark:text-violet-400",
    amber: "border-amber-600 text-amber-700 dark:text-amber-400",
    slate: "border-slate-500 text-slate-700 dark:text-slate-400",
  }[tone];

  return (
    <section className="space-y-2" data-testid={testid}>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={toneClass}>
          {number}
        </Badge>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">
          {t({ de: "Sichtbarkeit", en: "Scope" })}:
        </dt>
        <dd>{scope}</dd>
        <dt className="text-muted-foreground">
          {t({ de: "Auslöser", en: "Trigger" })}:
        </dt>
        <dd>{trigger}</dd>
        <dt className="text-muted-foreground">
          {t({ de: "Datei", en: "File" })}:
        </dt>
        <dd className="font-mono break-all">{file}</dd>
      </dl>
      {(fileLink || prListLink) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {fileLink && (
            <ExternalAnchor
              href={fileLink}
              testid={`${testid}-link-file`}
              label={t({ de: "Datei auf GitHub", en: "View file on GitHub" })}
            />
          )}
          {prListLink && (
            <ExternalAnchor
              href={prListLink}
              testid={`${testid}-link-prs`}
              label={t(
                prListLabel ?? {
                  de: "PRs dieses Flows",
                  en: "PRs from this flow",
                },
              )}
            />
          )}
        </div>
      )}
      <div className="space-y-2 text-sm">{body}</div>
    </section>
  );
}

function ExternalAnchor({
  href,
  testid,
  label,
}: {
  href: string;
  testid: string;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testid}
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
