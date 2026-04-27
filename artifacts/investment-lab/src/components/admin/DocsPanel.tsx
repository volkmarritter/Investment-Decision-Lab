// ----------------------------------------------------------------------------
// DocsPanel — operator-facing documentation of the admin update flows.
// ----------------------------------------------------------------------------
// Single source of truth for "where do my edits actually go and when are they
// visible to other users?". Five flows are described, each in EN + DE:
//   1. ETF catalog PR  — "ISIN vorschlagen" → opens PR to etfs.config.ts
//   2. Look-through pool PR — adds an ISIN to lookthrough.overrides.json
//   3. App-defaults PR — RF / Home-Bias / CMA written to app-defaults.json
//   4. Personal Methodology overrides — per-user localStorage, no PR
//   5. Monthly refresh job — cron-driven re-scrape of pool entries
//
// Implemented as a collapsible Card to mirror BrowseBucketsPanel's pattern so
// the operator can keep it folded once familiar but always one click away.
// ----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAdminT } from "@/lib/admin-i18n";

const STORAGE_KEY = "admin.docsPanel.open";

export function DocsPanel() {
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

          <FlowSection
            number={1}
            testid="docs-flow-etf-catalog"
            title={t({
              de: "ETF-Katalog (PR auf etfs.config.ts)",
              en: "ETF catalog (PR to etfs.config.ts)",
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
            file="artifacts/investment-lab/src/data/etfs.config.ts"
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
            file="etfs.overrides.json + lookthrough.overrides.json"
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
        </CardContent>
      )}
    </Card>
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
  body,
}: {
  number: number;
  testid: string;
  title: string;
  tone: "emerald" | "sky" | "violet" | "amber" | "slate";
  scope: string;
  trigger: string;
  file: string;
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
      <div className="space-y-2 text-sm">{body}</div>
    </section>
  );
}
