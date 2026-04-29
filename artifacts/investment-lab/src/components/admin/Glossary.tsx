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
    term: "Alternative",
    de: "Kuratierte Bucket-Alternative — austauschbare ETF-Variante (bis zu 10 pro Bucket).",
    en: "Curated bucket alternative — interchangeable ETF variant (up to 10 per bucket).",
  },
  {
    term: "Look-through",
    de: "Aufgelöste Holdings hinter einem Dach- oder Multi-Asset-ETF (Aktien-/Anleihen-Splits, Regionen, Sektoren).",
    en: "Resolved holdings behind a wrapper or multi-asset ETF (equity/bond splits, regions, sectors).",
  },
  {
    term: "Pool",
    de: "Look-through-Pool: zentrale Datei mit allen aufgelösten Holdings, die der Engine zur Look-through-Aggregation dient.",
    en: "Look-through pool: central file holding every resolved holding the engine uses for look-through aggregation.",
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
