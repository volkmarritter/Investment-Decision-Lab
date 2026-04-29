// ----------------------------------------------------------------------------
// TokenPrompt — admin sign-in card. Stored once per browser tab in
// sessionStorage so the bearer token unlocking Pull Request creation isn't
// persisted across tabs/windows.
// ----------------------------------------------------------------------------

import { useState } from "react";
import { useAdminT } from "@/lib/admin-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function TokenPrompt({
  error,
  onSubmit,
}: {
  error: string | null;
  onSubmit: (token: string) => void;
}) {
  const { t, lang, setLang } = useAdminT();
  const [value, setValue] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {t({ de: "Admin-Anmeldung", en: "Admin sign-in" })}
            </CardTitle>
            <button
              type="button"
              onClick={() => setLang(lang === "de" ? "en" : "de")}
              className="text-xs text-muted-foreground underline"
              data-testid="button-token-lang-toggle"
            >
              {lang === "de" ? "EN" : "DE"}
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {lang === "de" ? (
              <>
                Bitte das Admin-Token eingeben (auf dem api-server als{" "}
                <code>ADMIN_TOKEN</code> hinterlegt). Das Token wird nur für
                diesen Browser-Tab gespeichert.
              </>
            ) : (
              <>
                Enter the admin token (configured on the api-server as{" "}
                <code>ADMIN_TOKEN</code>). The token is stored for this browser
                tab only.
              </>
            )}
          </p>
          <Input
            type="password"
            placeholder={t({ de: "Admin-Token", en: "Admin token" })}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
            }}
            data-testid="input-admin-token"
          />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            className="w-full"
            disabled={!value.trim()}
            onClick={() => onSubmit(value.trim())}
            data-testid="button-admin-signin"
          >
            {t({ de: "Anmelden", en: "Sign in" })}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
