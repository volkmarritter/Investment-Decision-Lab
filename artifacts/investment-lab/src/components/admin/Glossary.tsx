import { useAdminT } from "@/lib/admin-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Term = { term: string; de: string; en: string };

const TERMS: Term[] = [
  {
    term: "Bucket",
    de: "Asset-Klasse-Eimer (z. B. equity_us, gov_bonds_eur). Jeder Bucket hat einen Default-ETF und bis zu 10 kuratierte Alternativen.",
    en: "Asset-class bucket (e.g. equity_us, gov_bonds_eur). Each bucket has a default ETF and up to 10 curated alternatives.",
  },
  {
    term: "Instrument",
    de: "Ein einzelner ETF in der Master-Liste, eindeutig per ISIN. Hier liegen Name, TER, Domizil, Replikation, Listings — die Stamm-Daten des Fonds. Ein Instrument lebt unabhängig davon, ob es einem Bucket zugeordnet ist.",
    en: "A single ETF in the master list, uniquely identified by ISIN. This is where name, TER, domicile, replication and listings live — the fund's master data. An instrument exists independently of whether it is assigned to a bucket.",
  },
  {
    term: "Bucket-Zuordnung",
    de: "Eigener Schritt nach der Instrument-Registrierung: ein bestehendes Instrument wird als Default oder Alternative an einen Bucket gehängt. Strenge Regel: jede ISIN darf in höchstens einem Bucket-Slot vorkommen — keine Mehrfach-Belegung über Buckets hinweg.",
    en: "A separate step after instrument registration: an existing instrument is attached to a bucket as either default or alternative. Strict rule — every ISIN may appear in at most one bucket slot; no cross-bucket reuse.",
  },
  {
    term: "Alternative",
    de: "Kuratierte Bucket-Alternative — austauschbare ETF-Variante (bis zu 10 pro Bucket).",
    en: "Curated bucket alternative — interchangeable ETF variant (up to 10 per bucket).",
  },
  {
    term: "Pool",
    de: "Erweitertes Universum eines Buckets — bis zu 50 ISINs, die in Build (über „Mehr ETFs“) und Explain (über die ISIN-Auswahl) zusätzlich zu Default und kuratierten Alternativen wählbar sind. Pool-Einträge sind keine Empfehlungen; sie erweitern die operative Auswahl. Strenge Regel: jede ISIN gehört zu höchstens einem Slot (Default ODER Alternative ODER Pool) eines einzigen Buckets.",
    en: "A bucket's extended universe — up to 50 ISINs that are pickable in Build (via the “More ETFs” dialog) and Explain (via the ISIN picker) on top of the default and curated alternatives. Pool entries are not recommendations; they widen the operator-facing choice. Strict rule: every ISIN may live in at most one slot (default OR alternative OR pool) of a single bucket.",
  },
  {
    term: "Look-through",
    de: "Aufgelöste Holdings hinter einem Dach- oder Multi-Asset-ETF (Aktien-/Anleihen-Splits, Regionen, Sektoren).",
    en: "Resolved holdings behind a wrapper or multi-asset ETF (equity/bond splits, regions, sectors).",
  },
  {
    term: "Look-through-Daten",
    de:
      "Look-through-Daten: zentrale JSON-Datei (lookthrough.overrides.json) mit den aufgelösten Holdings, die die Engine pro ETF anwendet. " +
      "Strikte Invariante seit Aufgabe #122: jede ISIN in dieser Datei muss auch in INSTRUMENTS (etfs.ts) registriert sein — INSTRUMENTS ist die alleinige Quelle der Wahrheit; die JSON-Datei trägt nur die volatilen Look-through-Felder.",
    en:
      "Look-through data: central JSON file (lookthrough.overrides.json) holding the resolved per-ETF holdings the engine applies. " +
      "Strict invariant since Task #122: every ISIN in this file must also be registered in INSTRUMENTS (etfs.ts) — INSTRUMENTS is the single source of truth; the JSON sidecar only carries the volatile look-through fields.",
  },
  {
    term: "Pull Request",
    de: "GitHub Pull Request — jede Daten-Änderung verlässt das Admin als Pull Request gegen den Basis-Branch und wird nach Merge ausgeliefert.",
    en: "GitHub pull request — every data change leaves the admin as a pull request against the base branch and ships after merge.",
  },
  {
    term: "Workspace sync",
    de: "Lokalen Workspace gegen origin/<base> synchronisieren — Voraussetzung für ein verlässliches Republish nach jedem Merge.",
    en: "Sync the local workspace against origin/<base> — prerequisite for a reliable republish after every merge.",
  },
];

export function Glossary() {
  const { t, lang } = useAdminT();
  return (
    <Card data-testid="docs-glossary">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {t({ de: "Glossar", en: "Glossary" })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {TERMS.map((term) => (
            <div key={term.term} data-testid={`glossary-${term.term.toLowerCase().replace(/\s+/g, "-")}`}>
              <dt className="font-medium">{term.term}</dt>
              <dd className="text-muted-foreground text-xs leading-snug">
                {lang === "de" ? term.de : term.en}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
