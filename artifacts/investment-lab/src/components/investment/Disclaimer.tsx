import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useT } from "@/lib/i18n";

export function DisclaimerFooter() {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <footer className="mt-12 border-t border-border bg-muted/30">
      <div className="container mx-auto px-4 py-6 space-y-3">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            <p>
              <span className="font-semibold text-foreground">
                {t("disclaimer.short.title")}
              </span>{" "}
              {t("disclaimer.short.body")}
            </p>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs underline underline-offset-2"
                >
                  {t("disclaimer.readFull")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{t("disclaimer.full.title")}</DialogTitle>
                  <DialogDescription>
                    {t("disclaimer.full.subtitle")}
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh] pr-4">
                  <DisclaimerBody />
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function DisclaimerBody() {
  const { t } = useT();
  const sections: { title: string; body: string }[] = [
    { title: t("disclaimer.s1.title"), body: t("disclaimer.s1.body") },
    { title: t("disclaimer.s2.title"), body: t("disclaimer.s2.body") },
    { title: t("disclaimer.s3.title"), body: t("disclaimer.s3.body") },
    { title: t("disclaimer.s4.title"), body: t("disclaimer.s4.body") },
    { title: t("disclaimer.s5.title"), body: t("disclaimer.s5.body") },
    { title: t("disclaimer.s6.title"), body: t("disclaimer.s6.body") },
    { title: t("disclaimer.s7.title"), body: t("disclaimer.s7.body") },
  ];

  return (
    <div className="space-y-4 text-sm leading-relaxed text-foreground">
      {sections.map((s, i) => (
        <div key={i}>
          <h4 className="font-semibold text-foreground mb-1">{s.title}</h4>
          <p className="text-muted-foreground">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

export function DisclaimerPdfBlock() {
  const { t } = useT();
  return (
    <div className="border-t border-border pt-4 mt-6 space-y-3 text-[10px] leading-snug text-muted-foreground">
      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
        {t("disclaimer.full.title")}
      </h3>
      <p className="italic">{t("disclaimer.full.subtitle")}</p>
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div key={i}>
          <span className="font-semibold text-foreground">
            {t(`disclaimer.s${i}.title`)}.
          </span>{" "}
          {t(`disclaimer.s${i}.body`)}
        </div>
      ))}
    </div>
  );
}
