import { Link, useLocation, useSearch } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminT } from "@/lib/admin-i18n";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { SubTabNav, type SubTab } from "@/components/admin/SubTabNav";
import { useAdminContext } from "@/components/admin/AdminContext";
import { ConsolidatedEtfTreePanel } from "@/components/admin/ConsolidatedEtfTreePanel";
import { SuggestIsinPanel } from "@/components/admin/SuggestIsinPanel";
import { BatchAddAlternativesPanel } from "@/components/admin/BatchAddAlternativesPanel";
import { InstrumentsPanel } from "@/components/admin/InstrumentsPanel";

export default function Catalog() {
  const { t } = useAdminT();
  const [location] = useLocation();
  // Task #122 (T006): the picker's empty-state hint links here with
  // `?prefillIsin=<ISIN>` so the operator can register the missing
  // ISIN in one click. We forward it to InstrumentsPanel which seeds
  // the create-form ISIN field.
  const search = useSearch();
  const prefillIsin = (() => {
    try {
      const v = new URLSearchParams(search).get("prefillIsin")?.trim().toUpperCase();
      return v && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(v) ? v : null;
    } catch {
      return null;
    }
  })();
  const { catalog, catalogError, githubConfigured, directWrite } = useAdminContext();

  const tabs: SubTab[] = [
    {
      to: "/admin/catalog/browse",
      label: t({ de: "Browse", en: "Browse" }),
      testid: "tab-catalog-browse",
    },
    {
      to: "/admin/catalog/instruments",
      label: t({ de: "Instrumente", en: "Instruments" }),
      testid: "tab-catalog-instruments",
    },
    {
      to: "/admin/catalog/add-isin",
      label: t({ de: "ISIN hinzufügen", en: "Add ISIN" }),
      testid: "tab-catalog-add-isin",
    },
    {
      to: "/admin/catalog/batch",
      label: t({ de: "Sammelweise", en: "Batch" }),
      testid: "tab-catalog-batch",
    },
  ];

  const active =
    location === "/admin/catalog/add-isin"
      ? "add-isin"
      : location === "/admin/catalog/batch"
        ? "batch"
        : location === "/admin/catalog/instruments"
          ? "instruments"
          : "browse";

  const description = {
    browse: t({
      de: "Alle Buckets mit ihren Default-ETFs, Alternativen und Look-through-Status in einem Baum.",
      en: "Every bucket with its default ETF, alternatives, and look-through status in a single tree.",
    }),
    instruments: t({
      de: "Master-Liste aller ETF-Instrumente. Hier werden Instrumente registriert, bearbeitet oder entfernt. Bucket-Zuordnung läuft separat: neue Defaults über „ISIN hinzufügen“, neue Alternativen über die Zeilen-Buttons im Browse-Tab. Instrumente ohne Bucket-Zuordnung bilden den Look-through-Pool.",
      en: "Master list of every ETF instrument. Register, edit or retire instruments here. Bucket assignment runs separately: new defaults via the 'Add ISIN' tab, new alternatives via the per-row buttons in the Browse tab. Instruments with no bucket assignment make up the look-through pool.",
    }),
    "add-isin": t(
      directWrite
        ? {
            de: "Eine ISIN scrapen, Felder prüfen und in einem Schritt speichern — registriert das Instrument und trägt es gleich als Bucket-Default ein.",
            en: "Scrape one ISIN, review the fields, and save in one step — registers the instrument and assigns it as a bucket default in one go.",
          }
        : {
            de: "Eine ISIN scrapen, Felder prüfen und einen einzelnen Pull Request öffnen, der das Instrument registriert und gleich als Bucket-Default einträgt.",
            en: "Scrape one ISIN, review the fields, and open a single pull request that registers the instrument and assigns it as a bucket default in one go.",
          },
    ),
    batch: t(
      directWrite
        ? {
            de: "Mehrere kuratierte Alternativen zusammenstellen und in einem Rutsch speichern.",
            en: "Queue multiple curated alternatives and save them all at once.",
          }
        : {
            de: "Mehrere kuratierte Alternativen zusammenstellen und alle in einem Pull Request öffnen.",
            en: "Queue multiple curated alternatives and ship them all in a single pull request.",
          },
    ),
  }[active];

  const primaryAction = active === "browse" ? (
    <Link href="/admin/catalog/add-isin" data-testid="catalog-primary-add-isin">
      <Button size="sm">
        <Plus className="h-4 w-4 mr-1" />
        {t({ de: "ISIN hinzufügen", en: "Add ISIN" })}
      </Button>
    </Link>
  ) : (
    <Link href="/admin/catalog/browse" data-testid="catalog-primary-browse">
      <Button size="sm" variant="outline">
        {t({ de: "Zur Übersicht", en: "Back to browse" })}
      </Button>
    </Link>
  );

  return (
    <section className="space-y-5" data-testid="page-admin-catalog">
      <SectionHeader
        title={t({ de: "Katalog", en: "Catalog" })}
        description={description}
        primaryAction={primaryAction}
        testid="header-admin-catalog"
      />
      <SubTabNav tabs={tabs} testid="subnav-catalog" />
      <div data-testid={`subpage-catalog-${active}`}>
        {active === "browse" && (
          <ConsolidatedEtfTreePanel
            catalog={catalog}
            catalogError={catalogError}
            githubConfigured={githubConfigured}
          />
        )}
        {active === "add-isin" && (
          <SuggestIsinPanel
            githubConfigured={githubConfigured}
            catalog={catalog}
            catalogError={catalogError}
          />
        )}
        {active === "batch" && (
          <BatchAddAlternativesPanel
            githubConfigured={githubConfigured}
            directWrite={directWrite}
          />
        )}
        {active === "instruments" && (
          <InstrumentsPanel
            githubConfigured={githubConfigured}
            prefillIsin={prefillIsin}
          />
        )}
      </div>
    </section>
  );
}
