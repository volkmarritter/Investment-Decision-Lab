import { useMemo, useState, useEffect } from "react";
import { ClipboardCopy } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { buildAiPrompt, type PromptMode } from "@/lib/aiPrompt";
import type { PortfolioInput } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  input: PortfolioInput | null;
  initialMode: PromptMode;
}

export function AiPromptPreviewDialog({ open, onOpenChange, input, initialMode }: Props) {
  const { t, lang } = useT();
  const [mode, setMode] = useState<PromptMode>(initialMode);

  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  const prompt = useMemo(() => {
    if (!input) return "";
    return buildAiPrompt(input, lang, mode);
  }, [input, lang, mode]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(t("build.toast.aiPromptCopied"));
    } catch {
      toast.error(t("build.toast.aiPromptError"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl w-[calc(100vw-2rem)] sm:w-full p-4 sm:p-6 flex flex-col max-h-[90dvh] overflow-hidden"
        closeLabel={t("build.aiPrompt.preview.close")}
        data-testid="ai-prompt-preview-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("build.aiPrompt.preview.title")}</DialogTitle>
          <DialogDescription>{t("build.aiPrompt.preview.helper")}</DialogDescription>
          <div className="flex flex-wrap gap-2 pt-2">
            {(["basic", "pro"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={mode === m ? "default" : "outline"}
                onClick={() => setMode(m)}
                data-testid={`ai-prompt-preview-mode-${m}`}
              >
                {t(
                  m === "basic"
                    ? "build.btn.copyAiPromptBasic"
                    : "build.btn.copyAiPromptPro",
                )}
              </Button>
            ))}
          </div>
        </DialogHeader>
        <pre
          className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words flex-1 min-h-0 overflow-y-auto rounded-md border bg-muted/30 p-3"
          data-testid="ai-prompt-preview-body"
        >
          {prompt}
        </pre>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="ai-prompt-preview-close"
          >
            {t("build.aiPrompt.preview.close")}
          </Button>
          <Button
            type="button"
            onClick={handleCopy}
            data-testid="ai-prompt-preview-copy"
          >
            <ClipboardCopy className="h-4 w-4 mr-2" />
            {t("build.aiPrompt.preview.copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
