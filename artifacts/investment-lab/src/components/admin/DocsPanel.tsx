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
              de: 'Diese Seite kennt fünf verschiedene Wege, Daten zu ändern. Jeder hat ein anderes Ziel, einen anderen Sichtbarkeitsbereich und eine andere Latenz, bis Endnutzer die Änderung sehen. Vor dem Klick auf „PR öffnen" lohnt sich ein Blick darauf, welcher Flow gerade läuft.',
              en: "This page exposes five distinct ways to change data. Each one has a different target, scope of visibility, and latency before end users see the change. Worth a glance before clicking 'Open PR' to confirm which flow is running.",
            })}
          </p>

          <AfterMergeCallout />

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

          <p className="text-xs text-muted-foreground">
            {t({
              de: 'Reihenfolge in der Praxis: Flow 1 + 2 öffnen PRs (review, merge, redeploy). Flow 3 öffnet einen PR für Default-Werte. Flow 4 ist eine reine Browser-Einstellung. Flow 5 läuft automatisch und braucht nur Beobachtung.',
              en: "Practical order: flows 1 + 2 open PRs (review, merge, redeploy). Flow 3 opens a PR for default values. Flow 4 is a pure browser-only setting. Flow 5 runs on its own and only needs monitoring.",
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
// AfterMergeCallout — captures the 2026-04-27 republish-race finding.
// ----------------------------------------------------------------------------
// Operator merged two PRs on github.com, clicked Republish, and the deployed
// app still served the pre-merge built-in defaults. Root cause: the deploy
// snapshot is built from whatever the workspace contains at the moment the
// Republish click is processed; if the GitHub→workspace sync hasn't pulled
// the merge commit yet, the build is from a pre-merge state. Fix is simply
// to Republish *again* once the merge has landed in the workspace's main.
// ----------------------------------------------------------------------------
function AfterMergeCallout() {
  const { lang, t } = useAdminT();
  return (
    <section
      className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3 space-y-2"
      data-testid="docs-after-merge-callout"
    >
      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4" />
        <h3 className="font-semibold text-sm">
          {t({
            de: "Was passiert nach dem Merge? (Republish-Reihenfolge)",
            en: "What happens after merge? (republish order)",
          })}
        </h3>
      </div>
      <div className="space-y-2 text-sm text-amber-900 dark:text-amber-100">
        {lang === "de" ? (
          <>
            <p>
              Merge ≠ Deploy. Die ausgelieferte App läuft aus einem{" "}
              <strong>Snapshot</strong>, den Replit zum Zeitpunkt des
              „Publish"-Klicks aus dem aktuellen Workspace-Stand baut. Wenn du
              auf „Republish" klickst, <em>bevor</em> der GitHub-Merge in den
              Workspace gesynct ist, wird ein Pre-Merge-Snapshot deployt — die
              alten Werte bleiben sichtbar, obwohl der PR auf{" "}
              <code>main</code> gemergt ist.
            </p>
            <p>
              <strong>Korrekte Reihenfolge:</strong>{" "}
              (1) PR auf GitHub mergen →{" "}
              (2) kurz warten, bis der Workspace die Änderung gezogen hat (im
              Files-Tree sichtbar) →{" "}
              (3) <strong>dann</strong> Replit „Republish" klicken →{" "}
              (4) im Inkognito-Fenster live prüfen.
            </p>
            <p>
              Betrifft alle bundle-getragenen Daten: Flows 1, 2, 3 (siehe
              unten). Flow 5 (monatlicher Job) ist davon unabhängig — die
              Override-Layer-Dateien werden zur Laufzeit gelesen.
            </p>
          </>
        ) : (
          <>
            <p>
              Merge ≠ deploy. The live app runs from a{" "}
              <strong>snapshot</strong> Replit builds at the moment of your
              "Publish" click, using the current workspace contents. Clicking
              "Republish" <em>before</em> the GitHub merge has synced into
              the workspace ships a pre-merge snapshot — the old values stay
              visible even though the PR is merged on <code>main</code>.
            </p>
            <p>
              <strong>Correct order:</strong>{" "}
              (1) merge the PR on GitHub →{" "}
              (2) wait briefly for the workspace to pull the change (visible
              in the file tree) →{" "}
              (3) <strong>then</strong> click "Republish" in Replit →{" "}
              (4) verify in an incognito window.
            </p>
            <p>
              Applies to every bundle-carried payload: flows 1, 2, 3 (see
              below). Flow 5 (monthly job) is unaffected — its override-layer
              files are read at runtime.
            </p>
          </>
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
  number: number;
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
