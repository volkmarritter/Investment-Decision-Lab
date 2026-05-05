// ----------------------------------------------------------------------------
// UnclassifiedRow — one pool entry with no bucket attachment, with an
// inline "attach to bucket" form (bucket picker + AddAlternativeForm
// pre-keyed to the picked bucket).
// ----------------------------------------------------------------------------

import { useState } from "react";
import type { LookthroughPoolEntry } from "@/lib/admin-api";
import { EtfLookthroughDialog } from "@/components/investment/EtfLookthroughDialog";
import { useAdminT } from "@/lib/admin-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LookthroughStatusBadge, PoolSourceBadge } from "./badges";
import { AsOfInline } from "./shared";
import { AddAlternativeForm } from "./AddAlternativeForm";

export function UnclassifiedRow({
  poolEntry,
  attaching,
  onAttachOpen,
  onCreated,
  catalogKeys,
  githubConfigured,
}: {
  poolEntry: LookthroughPoolEntry;
  attaching: { isin: string; presetName?: string } | null;
  onAttachOpen: () => void;
  onCreated: () => void;
  catalogKeys: string[];
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();
  const isOpen = attaching?.isin === poolEntry.isin;
  const [pickedBucket, setPickedBucket] = useState<string>("");
  // State for the look-through detail dialog (same content as the
  // ETFDetailsDialog used in the portfolio view) — operator opens it
  // before deciding whether to attach the ISIN to a bucket so they can
  // inspect the geo/sector/currency/top-holdings data we already have.
  const [lookthroughOpen, setLookthroughOpen] = useState(false);

  return (
    <div
      className="rounded border bg-background p-2"
      data-testid={`tree-unclassified-${poolEntry.isin}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge
            variant="outline"
            className="border-violet-600 text-violet-700 dark:text-violet-400 shrink-0"
          >
            {t({ de: "Pool-only", en: "Pool-only" })}
          </Badge>
          <span className="font-mono text-xs">{poolEntry.isin}</span>
          {poolEntry.name && (
            <span
              className="text-xs text-muted-foreground italic truncate"
              title={poolEntry.name}
            >
              · {poolEntry.name}
            </span>
          )}
          <LookthroughStatusBadge entry={poolEntry} />
          <span className="text-xs font-mono text-muted-foreground shrink-0">
            {poolEntry.topHoldingCount}/{poolEntry.geoCount}/
            {poolEntry.sectorCount}
          </span>
          <PoolSourceBadge entry={poolEntry} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setLookthroughOpen(true)}
            data-testid={`button-tree-lookthrough-${poolEntry.isin}`}
            title={t({
              de: "Look-through-Daten ansehen",
              en: "View look-through data",
            })}
          >
            {t({ de: "Look-through", en: "Look-through" })}
          </Button>
          {githubConfigured && (
            <Button
              type="button"
              size="sm"
              variant={isOpen ? "secondary" : "outline"}
              onClick={onAttachOpen}
              data-testid={`button-tree-attach-${poolEntry.isin}`}
            >
              {isOpen
                ? t({ de: "Schließen", en: "Close" })
                : t({ de: "Bucket zuordnen", en: "Attach to bucket" })}
            </Button>
          )}
        </div>
      </div>
      <EtfLookthroughDialog
        isin={lookthroughOpen ? poolEntry.isin : null}
        name={poolEntry.name}
        open={lookthroughOpen}
        onOpenChange={setLookthroughOpen}
      />
      {isOpen && (
        <div className="mt-2 border-t pt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <label className="font-medium">
              {t({ de: "Ziel-Bucket:", en: "Target bucket:" })}
            </label>
            <select
              value={pickedBucket}
              onChange={(e) => setPickedBucket(e.target.value)}
              className="border rounded px-2 py-1 text-xs bg-background"
              data-testid={`select-tree-attach-bucket-${poolEntry.isin}`}
            >
              <option value="">
                {t({ de: "— bitte wählen —", en: "— please pick —" })}
              </option>
              {catalogKeys
                .slice()
                .sort((a, b) => a.localeCompare(b))
                .map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
            </select>
          </div>
          {pickedBucket ? (
            <AddAlternativeForm
              key={`${poolEntry.isin}-${pickedBucket}`}
              parentKey={pickedBucket}
              githubConfigured={githubConfigured}
              onCreated={onCreated}
              presetIsin={poolEntry.isin}
              presetName={poolEntry.name ?? undefined}
              presetInfo={
                <div
                  className="rounded-md border bg-sky-50 dark:bg-sky-950/40 p-3 text-xs space-y-1"
                  data-testid={`tree-attach-info-${poolEntry.isin}`}
                >
                  <div className="font-medium text-sky-900 dark:text-sky-200">
                    {t({
                      de: "Bereits im Look-through-Pool vorhanden:",
                      en: "Already on file in the look-through pool:",
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sky-900 dark:text-sky-200">
                    <span className="text-muted-foreground">ISIN</span>
                    <span className="font-mono">{poolEntry.isin}</span>
                    {poolEntry.name && (
                      <>
                        <span className="text-muted-foreground">
                          {t({ de: "Name", en: "Name" })}
                        </span>
                        <span>{poolEntry.name}</span>
                      </>
                    )}
                    <span className="text-muted-foreground">
                      {t({ de: "Quelle", en: "Source" })}
                    </span>
                    <span>
                      {poolEntry.source === "pool"
                        ? t({ de: "Auto-Refresh", en: "Auto-refresh" })
                        : poolEntry.source === "both"
                          ? t({ de: "Beide", en: "Both" })
                          : t({ de: "Kuratiert", en: "Curated" })}
                    </span>
                    <span className="text-muted-foreground">
                      {t({ de: "Top/Geo/Sektor", en: "Top/Geo/Sector" })}
                    </span>
                    <span className="font-mono">
                      {poolEntry.topHoldingCount}/{poolEntry.geoCount}/
                      {poolEntry.sectorCount}
                    </span>
                    {(poolEntry.topHoldingsAsOf ||
                      poolEntry.breakdownsAsOf) && (
                      <>
                        <span className="text-muted-foreground">
                          {t({ de: "Stand", en: "As of" })}
                        </span>
                        <AsOfInline
                          value={
                            poolEntry.topHoldingsAsOf ||
                            poolEntry.breakdownsAsOf
                          }
                          lang={lang}
                        />
                      </>
                    )}
                  </div>
                  <div className="text-muted-foreground pt-1 border-t border-sky-200 dark:border-sky-900 mt-2">
                    {t({
                      de: "ISIN und Name wurden bereits eingetragen. Wir holen die übrigen Stammdaten (TER, Domizil, Listings …) automatisch von justETF — danach prüfen und oben speichern.",
                      en: "ISIN and name are already filled in. We fetch the remaining base data (TER, domicile, listings …) from justETF automatically — review them and save above.",
                    })}
                  </div>
                </div>
              }
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t({
                de: "Bucket wählen, dann erscheint das Add-Formular mit der ISIN und den bekannten Pool-Daten vorausgefüllt.",
                en: "Pick a bucket — the add form will appear with the ISIN and the known pool data pre-filled.",
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
