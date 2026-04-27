import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n";

export function LangToggle() {
  const { lang, setLang } = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          data-testid="button-lang-toggle"
          aria-label="Language"
        >
          <Languages className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase">{lang}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => setLang("en")}
          data-testid="lang-option-en"
        >
          English {lang === "en" ? "✓" : ""}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setLang("de")}
          data-testid="lang-option-de"
        >
          Deutsch {lang === "de" ? "✓" : ""}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
