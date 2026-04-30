// ----------------------------------------------------------------------------
  // DocsPanel.parts — sub-components used by DocsPanel.tsx (split out so the
  // main file stays under the 800-line cap).
  // ----------------------------------------------------------------------------

  import type { ReactNode } from "react";
  import { AlertTriangle, ExternalLink } from "lucide-react";
  import { Badge } from "@/components/ui/badge";
  import { useAdminT } from "@/lib/admin-i18n";

  export interface AfterMergeCalloutProps {
  autoMergeRunsUrl: string | null;
  allPrsUrl: string | null;
}

export function AfterMergeCallout({
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
              {t({ de: "Pull Request öffnen (du)", en: "Open Pull Request (you)" })}
            </strong>
            <div className="mt-1 ml-1">
              {lang === "de" ? (
                <>
                  Klick auf „Pull Request öffnen" / „Aufnehmen" im Admin schickt eine
                  Pull-Request-Anfrage an GitHub. Sie taucht oben in der Karte{" "}
                  „Offene Pull Requests" auf.
                </>
              ) : (
                <>
                  Clicking "Open Pull Request" / "Add" in the admin sends a pull-request
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
                      de: "Pull Request-Liste auf GitHub",
                      en: "Pull Request list on GitHub",
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
                  Eine GitHub-Action erkennt Admin-Pull Requests an ihrem Branch-Namen
                  (<code>add-etf/</code>, <code>add-alt/</code>, <code>rm-alt/</code>,{" "}
                  <code>add-lookthrough-pool/</code>, <code>update-app-defaults/</code>,{" "}
                  <code>backfill-</code>, <code>instr-add/</code>, <code>instr-edit/</code>,{" "}
                  <code>instr-rm/</code>) und mergt sie automatisch,
                  sobald sie konfliktfrei sind. Der Branch wird danach
                  gelöscht. Wenn du einen Pull Request <em>vor</em> dem Merge selbst
                  prüfen willst, konvertiere ihn auf GitHub in einen{" "}
                  <strong>Draft</strong> — die Action lässt Drafts in Ruhe.
                </>
              ) : (
                <>
                  A GitHub Action recognizes admin Pull Requests by their branch name
                  (<code>add-etf/</code>, <code>add-alt/</code>, <code>rm-alt/</code>,{" "}
                  <code>add-lookthrough-pool/</code>, <code>update-app-defaults/</code>,{" "}
                  <code>backfill-</code>, <code>instr-add/</code>, <code>instr-edit/</code>,{" "}
                  <code>instr-rm/</code>) and squash-merges them as
                  soon as they are conflict-free. The branch is deleted
                  afterwards. If you want to review a Pull Request <em>before</em> it
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
                    Replit zieht den Merge <strong>nicht</strong> von selbst in
                    den Workspace — du musst ihn aktiv abholen. Dafür ist die
                    Karte <strong>„Workspace-Synchronisation"</strong> (Flow 6)
                    da:
                    {" "}
                    <strong>„Aus Origin aktualisieren"</strong> klicken,
                    danach — falls „Hinter Origin" {">"} 0 — auf{" "}
                    <strong>„Commits ziehen"</strong>. Im{" "}
                    <strong>Files-Tab</strong> links kannst du gegenchecken,
                    ob die geänderte Datei (z. B.{" "}
                    <code>lookthrough.overrides.json</code>) tatsächlich den
                    neuen Stand zeigt. <strong>Erst dann</strong> oben rechts
                    auf <strong>„Republish"</strong> klicken — der neue
                    Live-Snapshot ist nach 1–3 Min draußen.
                  </p>
                  <p>
                    <strong>Optional, einmal einrichten:</strong> Im{" "}
                    Deployments-Tab den Schalter „Redeploy on commit"
                    einschalten. Dann macht Replit den Republish automatisch
                    nach jedem Auto-Merge. Den Workspace-Sync musst du in
                    diesem Tab trotzdem nicht selbst machen, weil das Deployment
                    seinen eigenen frischen Checkout zieht.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Replit does <strong>not</strong> pull the merge into the
                    workspace on its own — you have to fetch it. That is what
                    the <strong>"Workspace sync"</strong> card (Flow 6) is for:
                    click <strong>"Refresh from origin"</strong>, then — if
                    "Behind origin" {">"} 0 — click <strong>"Pull commits"</strong>.
                    In the <strong>Files tab</strong> on the left you can
                    double-check that the changed file (e.g.{" "}
                    <code>lookthrough.overrides.json</code>) actually reflects
                    the new state. <strong>Only then</strong> click{" "}
                    <strong>"Republish"</strong> at the top right — the new
                    live snapshot is out in 1–3 minutes.
                  </p>
                  <p>
                    <strong>Optional, one-time setup:</strong> In the
                    Deployments tab toggle "Redeploy on commit" on. Then Replit
                    Republishes automatically after every auto-merge. You still
                    don't need a manual workspace-sync for that path, because
                    the deployment pulls its own fresh checkout.
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
              <em>ohne vorher den Workspace zu syncen</em>. Folge: alter
              Stand wird ausgeliefert, obwohl der Pull Request gemergt ist. Reihenfolge
              ist also: <strong>1.</strong> Workspace-Sync (Flow 6),{" "}
              <strong>2.</strong> Files-Tab kurz prüfen, <strong>3.</strong>
              {" "}Republish.
            </>
          ) : (
            <>
              <strong>Common mistake:</strong> Clicking "Republish"{" "}
              <em>without syncing the workspace first</em>. Result: the old
              state ships even though the Pull Request is merged. Order is:{" "}
              <strong>1.</strong> Workspace sync (Flow 6),{" "}
              <strong>2.</strong> quick check in the Files tab,{" "}
              <strong>3.</strong> Republish.
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

export function FlowSection({
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
  // Actions" instead of "Open Pull Requests" because there are no Pull Requests for the cron job.
  prListLabel?: { de: string; en: string };
  body: ReactNode;
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
                  de: "Pull Requests dieses Flows",
                  en: "Pull Requests from this flow",
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

// ---------------------------------------------------------------------------
// FileInventorySection — read-only reference card listing every file an
// operator (or PR reviewer) might touch when maintaining the ETF catalog,
// look-through pool, runtime overrides, refresh scripts and CI workflows.
//
// Each entry is rendered as `path` + a one-line description. `path` is shown
// in monospace; when the api-server is configured with owner/repo a clickable
// "GitHub" link is appended. Paths must be repo-relative POSIX paths.
// ---------------------------------------------------------------------------

export interface FileInventoryEntry {
  path: string;
  // Optional anchor like "#L157" or sub-path like "lib/" appended after path.
  // Use sparingly — only when the in-file location matters (e.g. the
  // INSTRUMENTS / BUCKETS / validateCatalog landmarks inside the 1.4k-line
  // etfs.ts).
  hint?: string;
  description: ReactNode;
}

export interface FileInventoryGroup {
  title: string;
  blurb?: ReactNode;
  entries: FileInventoryEntry[];
}

export interface FileInventorySectionProps {
  testid: string;
  heading: string;
  intro?: ReactNode;
  groups: FileInventoryGroup[];
  // Builds a github.com URL for a repo-relative path. Returning null hides
  // the per-row "GitHub" link (when GITHUB_OWNER/REPO is unset).
  buildFileUrl: (path: string) => string | null;
  githubLabel: string;
}

export function FileInventorySection({
  testid,
  heading,
  intro,
  groups,
  buildFileUrl,
  githubLabel,
}: FileInventorySectionProps) {
  return (
    <section className="space-y-3" data-testid={testid}>
      <h3 className="font-semibold">{heading}</h3>
      {intro ? <div className="text-sm text-muted-foreground">{intro}</div> : null}
      {groups.map((group, gIdx) => (
        <div
          key={gIdx}
          className="space-y-2"
          data-testid={`${testid}-group-${gIdx}`}
        >
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.title}
          </h4>
          {group.blurb ? (
            <p className="text-xs text-muted-foreground">{group.blurb}</p>
          ) : null}
          <ul className="space-y-1.5 text-xs">
            {group.entries.map((entry, eIdx) => {
              const url = buildFileUrl(entry.path);
              return (
                <li
                  key={eIdx}
                  className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_max-content] gap-x-3 gap-y-0.5"
                  data-testid={`${testid}-entry-${gIdx}-${eIdx}`}
                >
                  <div className="min-w-0">
                    <div className="font-mono break-all">
                      {entry.path}
                      {entry.hint ? (
                        <span className="text-muted-foreground"> {entry.hint}</span>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground">
                      {entry.description}
                    </div>
                  </div>
                  {url ? (
                    <div className="sm:pt-0.5">
                      <ExternalAnchor
                        href={url}
                        testid={`${testid}-entry-${gIdx}-${eIdx}-link`}
                        label={githubLabel}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function ExternalAnchor({
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
