import { ReactNode, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { nextMaximisedState } from "@/lib/maximisable";

export type MaximisableSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  maximiseLabel: string;
  maximiseHint: string;
  closeLabel: string;
  dialogTitle: ReactNode;
  dialogDescription?: string;
  testIdPrefix: string;
  renderContent: (opts: { compact: boolean }) => ReactNode;
  renderFooter?: () => ReactNode;
  /**
   * Optional content rendered in the card header to the LEFT of the
   * maximise button. Used by the ETF Implementation panel to host
   * extra header actions like "Reset ETFs to Default" without
   * forcing every consumer to wrap the title in a custom layout.
   * Not rendered in the maximised dialog header — those actions are
   * only meaningful in the inline (non-dialog) view.
   */
  headerExtra?: ReactNode;
};

export function MaximisableSection({
  title,
  description,
  maximiseLabel,
  maximiseHint,
  closeLabel,
  dialogTitle,
  dialogDescription,
  testIdPrefix,
  renderContent,
  renderFooter,
  headerExtra,
}: MaximisableSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5 min-w-0">
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-2">
            {headerExtra}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden md:inline-flex h-8 w-8"
                  onClick={() => setOpen((prev) => nextMaximisedState(prev, "toggle"))}
                  data-testid={`${testIdPrefix}-maximise-button`}
                  aria-label={maximiseLabel}
                  title={maximiseLabel}
                >
                  <Maximize2 className="h-4 w-4" />
                  <span className="sr-only">{maximiseLabel}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{maximiseHint}</TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent>
          {renderContent({ compact: false })}
          {renderFooter?.()}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(o) =>
          setOpen((prev) => nextMaximisedState(prev, o ? "open" : "close"))
        }
      >
        <DialogContent
          className="w-[95vw] max-w-[95vw] h-[95vh] flex flex-col p-0 gap-0 sm:rounded-lg"
          data-testid={`${testIdPrefix}-dialog`}
          closeLabel={closeLabel}
        >
          <DialogHeader className="px-6 py-4 border-b shrink-0 text-left">
            <DialogTitle>{dialogTitle}</DialogTitle>
            {dialogDescription && (
              <DialogDescription className="sr-only">
                {dialogDescription}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
            {renderContent({ compact: true })}
          </div>
          {renderFooter && (
            <div className="px-6 py-3 border-t shrink-0">{renderFooter()}</div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
