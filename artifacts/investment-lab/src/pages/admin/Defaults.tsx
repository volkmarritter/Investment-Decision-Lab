// ----------------------------------------------------------------------------
// Defaults — /admin/defaults. Single panel: AppDefaultsPanel.
// ----------------------------------------------------------------------------

import { useAdminT } from "@/lib/admin-i18n";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { useAdminContext } from "@/components/admin/AdminContext";
import { AppDefaultsPanel } from "@/components/admin/AppDefaultsPanel";

export default function Defaults() {
  const { t } = useAdminT();
  const { githubConfigured } = useAdminContext();
  return (
    <section className="space-y-5" data-testid="page-admin-defaults">
      <SectionHeader
        title={t({ de: "Defaults", en: "Defaults" })}
        description={t({
          de: "Globale Standardwerte für Risk-free Rate, Home-Bias und Capital Market Assumptions. Änderungen werden als Pull Request auf app-defaults.json eröffnet.",
          en: "Global default values for the risk-free rate, home bias, and capital market assumptions. Changes ship as a pull request to app-defaults.json.",
        })}
        testid="header-admin-defaults"
      />
      <AppDefaultsPanel githubConfigured={githubConfigured} />
    </section>
  );
}
