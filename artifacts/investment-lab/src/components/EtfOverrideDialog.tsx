// ----------------------------------------------------------------------------
// EtfOverrideDialog.tsx
// ----------------------------------------------------------------------------
// "Swap this bucket's ETF" dialog used by the Methodology tab. Flow:
//
//   1. User opens the dialog from a leaf in the bucket tree.
//   2. Types an ISIN, clicks Preview → public /api/etf-preview/:isin scrape.
//   3. We render the current bucket ETF and the scraped candidate side by
//      side, highlighting the rows that would change.
//   4. Apply persists the candidate via setETFOverride() so every
//      downstream surface (recommendations, fee table, Monte Carlo cost
//      basis, look-through) reflects the swap on the next render.
//
// Overrides are local-only (localStorage); Reset is offered separately on
// the tree leaf itself, not in this dialog.
// ----------------------------------------------------------------------------

import { useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { previewEtf, type PublicPreviewResponse } from "@/lib/etf-api";
import {
  setETFOverride,
} from "@/lib/etfOverrides";
import type { ETFRecord, ExchangeCode, ListingMap } from "@/lib/etfs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bucketKey: string;
  current: ETFRecord;
  de: boolean;
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const VALID_EXCHANGES: ExchangeCode[] = ["LSE", "XETRA", "SIX", "Euronext"];

// Coerce raw scrape fields + listings into a fully-formed ETFRecord we can
// hand to setETFOverride(). Anything missing from the scrape falls back to
// the current bucket entry so partial scrapes still produce a valid record.
function buildCandidate(
  preview: PublicPreviewResponse,
  current: ETFRecord,
): ETFRecord {
  const f = preview.fields;
  const listings: ListingMap = {};
  if (preview.listings) {
    for (const [exch, val] of Object.entries(preview.listings)) {
      if (!VALID_EXCHANGES.includes(exch as ExchangeCode)) continue;
      const t = val?.ticker;
      if (typeof t === "string" && t.length > 0) {
        listings[exch as ExchangeCode] = { ticker: t };
      }
    }
  }
  // Listings are required by the override sanitizer — fall back to the
  // current bucket's listings if the scrape didn't pick any up.
  const finalListings: ListingMap =
    Object.keys(listings).length > 0 ? listings : current.listings;

  // Default exchange: keep the current preference if it's still available
  // in the new listings, otherwise pick the first available.
  const defaultExchange: ExchangeCode = finalListings[current.defaultExchange]
    ? current.defaultExchange
    : (Object.keys(finalListings)[0] as ExchangeCode) ?? current.defaultExchange;

  const candidate: ETFRecord = {
    name: typeof f.name === "string" ? f.name : current.name,
    isin: preview.isin,
    terBps: typeof f.terBps === "number" ? f.terBps : current.terBps,
    domicile: typeof f.domicile === "string" ? f.domicile : current.domicile,
    replication:
      f.replication === "Physical" ||
      f.replication === "Physical (sampled)" ||
      f.replication === "Synthetic"
        ? f.replication
        : current.replication,
    distribution:
      f.distribution === "Accumulating" || f.distribution === "Distributing"
        ? f.distribution
        : current.distribution,
    currency: typeof f.currency === "string" ? f.currency : current.currency,
    comment: current.comment,
    listings: finalListings,
    defaultExchange,
  };
  if (typeof f.aumMillionsEUR === "number") {
    candidate.aumMillionsEUR = f.aumMillionsEUR;
  }
  if (typeof f.inceptionDate === "string") {
    candidate.inceptionDate = f.inceptionDate;
  }
  return candidate;
}

function formatListings(listings: ListingMap): string {
  const parts = Object.entries(listings).map(
    ([ex, v]) => `${ex}:${v?.ticker ?? "?"}`,
  );
  return parts.length > 0 ? parts.join(", ") : "—";
}

export function EtfOverrideDialog({
  open,
  onOpenChange,
  bucketKey,
  current,
  de,
}: Props) {
  const [isin, setIsin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ETFRecord | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  // Reset all transient state whenever the dialog re-opens so the previous
  // session's preview / error doesn't leak into a fresh override attempt.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setIsin("");
      setError(null);
      setCandidate(null);
      setSourceUrl(null);
      setLoading(false);
    }
    onOpenChange(next);
  };

  const handlePreview = async () => {
    const cleaned = isin.trim().toUpperCase();
    if (!ISIN_RE.test(cleaned)) {
      setError(de ? "Ungültige ISIN-Syntax." : "Invalid ISIN syntax.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await previewEtf(cleaned);
      setCandidate(buildCandidate(res, current));
      setSourceUrl(res.sourceUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setCandidate(null);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!candidate) return;
    setETFOverride(bucketKey, candidate);
    handleOpenChange(false);
  };

  // Diff helper: returns true when the candidate's value differs from the
  // current value for the same field. Drives the row-highlight style.
  const isDiff = (a: unknown, b: unknown) => {
    if (typeof a === "object" && typeof b === "object") {
      return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
    }
    return a !== b;
  };

  const rows: { label: string; field: keyof ETFRecord; render?: (v: ETFRecord) => string }[] = [
    { label: de ? "Name" : "Name", field: "name", render: (v) => v.name },
    { label: "ISIN", field: "isin", render: (v) => v.isin },
    {
      label: "TER (bps)",
      field: "terBps",
      render: (v) => String(v.terBps),
    },
    {
      label: de ? "Domizil" : "Domicile",
      field: "domicile",
      render: (v) => v.domicile,
    },
    {
      label: de ? "Replikation" : "Replication",
      field: "replication",
      render: (v) => v.replication,
    },
    {
      label: de ? "Verwendung" : "Distribution",
      field: "distribution",
      render: (v) => v.distribution,
    },
    {
      label: de ? "Währung" : "Currency",
      field: "currency",
      render: (v) => v.currency,
    },
    {
      label: "AUM (EUR mn)",
      field: "aumMillionsEUR",
      render: (v) => (typeof v.aumMillionsEUR === "number" ? String(v.aumMillionsEUR) : "—"),
    },
    {
      label: de ? "Auflagedatum" : "Inception",
      field: "inceptionDate",
      render: (v) => v.inceptionDate ?? "—",
    },
    {
      label: de ? "Börsen" : "Listings",
      field: "listings",
      render: (v) => formatListings(v.listings),
    },
    {
      label: de ? "Standardbörse" : "Default exchange",
      field: "defaultExchange",
      render: (v) => v.defaultExchange,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="etf-override-dialog">
        <DialogHeader>
          <DialogTitle>
            {de ? "ETF dieses Buckets ersetzen" : "Override this bucket's ETF"}
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{bucketKey}</span>{" — "}
            {de
              ? "Geben Sie eine ISIN ein, vergleichen Sie und übernehmen Sie. Änderungen werden lokal in Ihrem Browser gespeichert."
              : "Enter an ISIN, compare, and apply. Changes are stored locally in your browser only."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1 flex-1 min-w-[16rem]">
              <Label htmlFor="override-isin" className="text-xs">
                {de ? "Neue ISIN" : "New ISIN"}
              </Label>
              <Input
                id="override-isin"
                data-testid="input-override-isin"
                value={isin}
                onChange={(e) => setIsin(e.target.value.toUpperCase())}
                placeholder="IE00B5BMR087"
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handlePreview();
                }}
              />
            </div>
            <Button
              type="button"
              onClick={() => void handlePreview()}
              disabled={loading || !isin.trim()}
              data-testid="button-preview-override"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  {de ? "Lade…" : "Loading…"}
                </>
              ) : de ? (
                "Vergleichen"
              ) : (
                "Compare"
              )}
            </Button>
          </div>

          {error && (
            <Alert variant="destructive" data-testid="alert-override-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {candidate && (
            <div className="space-y-2">
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-44">{de ? "Feld" : "Field"}</TableHead>
                      <TableHead>{de ? "Aktuell" : "Current"}</TableHead>
                      <TableHead>{de ? "Neuer Kandidat" : "New candidate"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const aVal = current[r.field];
                      const bVal = candidate[r.field];
                      const diff = isDiff(aVal, bVal);
                      const aText = r.render ? r.render(current) : String(aVal ?? "—");
                      const bText = r.render ? r.render(candidate) : String(bVal ?? "—");
                      return (
                        <TableRow
                          key={r.field as string}
                          className={diff ? "bg-amber-500/10" : undefined}
                          data-testid={`override-row-${r.field as string}`}
                        >
                          <TableCell className="text-xs font-medium">
                            {r.label}
                            {diff && (
                              <Badge
                                variant="outline"
                                className="ml-2 text-[10px] px-1.5 py-0"
                              >
                                Δ
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{aText}</TableCell>
                          <TableCell className="text-xs font-mono">{bText}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {sourceUrl && (
                <p className="text-[10px] text-muted-foreground">
                  {de ? "Quelle: " : "Source: "}
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-primary break-all"
                  >
                    {sourceUrl}
                  </a>
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            data-testid="button-cancel-override"
          >
            {de ? "Abbrechen" : "Cancel"}
          </Button>
          <Button
            onClick={handleApply}
            disabled={!candidate}
            data-testid="button-apply-override"
          >
            {de ? "Übernehmen" : "Apply override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
