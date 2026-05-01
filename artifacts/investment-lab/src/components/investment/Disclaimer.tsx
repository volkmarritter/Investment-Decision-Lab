import { useState } from "react";
import { Mail, ShieldAlert } from "lucide-react";
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
import { BRAND, biconContactMailto, biconSiteUrl } from "@/lib/brand";

export function DisclaimerFooter() {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  // Language-aware BICon site link (German default vs English subpath).
  const biconHref = biconSiteUrl(lang);

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

        {/* BICon attribution row — language-aware site link, mailto CTA,
         *  and a copyright/discipline line. Carries the brand and a
         *  contact path on every screen so the showcase nature is
         *  visible without needing to scroll back to the header. */}
        <div
          className="border-t border-border/60 pt-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 text-xs text-muted-foreground"
          data-testid="bicon-footer-attribution"
        >
          <div className="min-w-0">
            <p className="leading-relaxed">
              © {BRAND.copyrightYear} {BRAND.fullName} –{" "}
              <span className="whitespace-nowrap">{BRAND.disciplineTagline}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs gap-1.5"
            >
              <a
                href={biconContactMailto(lang)}
                data-testid="bicon-footer-mailto"
                aria-label={t("header.bicon.cta.aria")}
              >
                <Mail className="h-3 w-3" aria-hidden="true" />
                <span>{BRAND.contactEmail}</span>
              </a>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs"
            >
              <a
                href={biconHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="bicon-link"
              >
                {BRAND.hostLabel}
              </a>
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function DisclaimerBody() {
  const { t } = useT();
  // Section order is meaningful: s8 (non-commercial / BICon-showcase
  // notice) is rendered first so visitors see the framing before the
  // legal-style sections that follow.
  const sections: { title: string; body: string }[] = [
    { title: t("disclaimer.s8.title"), body: t("disclaimer.s8.body") },
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
    <div className="pdf-only hidden border-t border-border pt-4 mt-6 space-y-3 text-[10px] leading-snug text-muted-foreground">
      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">
        {t("disclaimer.full.title")}
      </h3>
      <p className="italic">{t("disclaimer.full.subtitle")}</p>
      {[8, 1, 2, 3, 4, 5, 6, 7].map((i) => (
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
