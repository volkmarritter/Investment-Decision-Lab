import { useEffect, useState } from "react";
import { adminApi, type AddEtfRequest } from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AdvancedDisclosure } from "./AdvancedDisclosure";

export function GeneratedCodeDisclosure({ draft }: { draft: AddEtfRequest }) {
  const { t } = useAdminT();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(() => {
      adminApi
        .renderEntry(draft)
        .then((r) => {
          if (!cancelled) setCode(r.code);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [draft]);

  return (
    <AdvancedDisclosure
      label={t({ de: "Generierten Code anzeigen", en: "Show generated code" })}
      testid="button-show-generated-code"
    >
      <div data-testid="generated-code-block">
        {loading && !code && (
          <p className="text-xs text-muted-foreground">
            {t({ de: "Wird gerendert …", en: "Rendering …" })}
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {code && (
          <pre className="text-[11px] bg-background border rounded p-2 overflow-x-auto whitespace-pre">
            {code}
          </pre>
        )}
      </div>
    </AdvancedDisclosure>
  );
}
