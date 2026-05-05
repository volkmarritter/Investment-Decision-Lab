// Docs — /admin/docs. Glossary + DocsPanel.

import { useAdminT } from "@/lib/admin-i18n";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { useAdminContext } from "@/components/admin/AdminContext";
import { DocsPanel } from "@/components/admin/DocsPanel";
import { Glossary } from "@/components/admin/Glossary";

export default function Docs() {
  const { t } = useAdminT();
  const { githubInfo, directWrite } = useAdminContext();
  return (
    <section className="space-y-5" data-testid="page-admin-docs">
      <SectionHeader
        title={t({ de: "Dokumentation", en: "Documentation" })}
        description={t(
          directWrite
            ? {
                de: "Direkt-Schreib-Modus: Edits speichern sofort. Die 3-Schritte-Anleitung zum Veröffentlichen steht im grünen Kasten unten.",
                en: "Direct-write mode: edits save instantly. The 3-step recipe for shipping to production lives in the green callout below.",
              }
            : {
                de: "Wie die Update-Flows funktionieren — wo deine Edits landen und wann andere sie sehen.",
                en: "How the update flows work — where your edits land and when others see them.",
              },
        )}
        testid="header-admin-docs"
      />
      <Glossary />
      <DocsPanel github={githubInfo} directWrite={directWrite} />
    </section>
  );
}
