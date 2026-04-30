import { useState } from "react";
import { format } from "date-fns";
import { Save, Bookmark, Trash2, Play, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ExplainWorkspace,
  SavedExplainPortfolio,
  deleteSavedExplainPortfolio,
  renameSavedExplainPortfolio,
  saveExplainPortfolio,
  useSavedExplainPortfolios,
} from "@/lib/savedExplainPortfolios";
import { useT } from "@/lib/i18n";

export interface SavedExplainPortfoliosUIProps {
  /** True when there is at least one position to save. */
  canSave: boolean;
  /** Returns the current Explain workspace to snapshot. */
  getCurrentWorkspace: () => ExplainWorkspace;
  /** Called when the user picks a saved portfolio to restore. */
  onLoadPortfolio: (portfolio: SavedExplainPortfolio) => void;
}

export function SavedExplainPortfoliosUI({
  canSave,
  getCurrentWorkspace,
  onLoadPortfolio,
}: SavedExplainPortfoliosUIProps) {
  const { t } = useT();
  const { portfolios } = useSavedExplainPortfolios();
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [isListOpen, setIsListOpen] = useState(false);

  const openSaveDialog = () => {
    setSaveName(`${t("explain.saved.save.placeholder")} ${portfolios.length + 1}`);
    setIsSaveOpen(true);
  };

  const handleSave = () => {
    const name = saveName.trim();
    if (!name) return;
    saveExplainPortfolio(name, getCurrentWorkspace());
    toast.success(t("explain.saved.toast.saved"));
    setIsSaveOpen(false);
    setSaveName("");
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="explain-saved-bar"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canSave}
        onClick={openSaveDialog}
        className="h-8 text-xs"
        data-testid="explain-saved-save"
      >
        <Save className="h-3 w-3 mr-1.5" />
        {t("explain.saved.btn.save")}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsListOpen(true)}
        className="h-8 text-xs"
        data-testid="explain-saved-list"
      >
        <Bookmark className="h-3 w-3 mr-1.5" />
        {t("explain.saved.btn.saved").replace(
          "{count}",
          String(portfolios.length),
        )}
      </Button>

      {/* Save dialog */}
      <Dialog
        open={isSaveOpen}
        onOpenChange={(open) => !open && setIsSaveOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("explain.saved.save.title")}</DialogTitle>
            <DialogDescription>{t("explain.saved.save.desc")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t("explain.saved.save.placeholder")}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              autoFocus
              data-testid="explain-saved-name-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveOpen(false)}>
              {t("explain.saved.save.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!saveName.trim()}
              data-testid="explain-saved-save-submit"
            >
              {t("explain.saved.save.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* List dialog */}
      <Dialog open={isListOpen} onOpenChange={setIsListOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("explain.saved.list.title")}</DialogTitle>
            <DialogDescription>{t("explain.saved.list.desc")}</DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar space-y-3">
            {portfolios.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-muted/20">
                <Bookmark className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                <p className="text-sm font-medium">
                  {t("explain.saved.empty.title")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("explain.saved.empty.desc")}
                </p>
              </div>
            ) : (
              portfolios.map((portfolio) => (
                <PortfolioItem
                  key={portfolio.id}
                  portfolio={portfolio}
                  onLoad={(p) => {
                    setIsListOpen(false);
                    onLoadPortfolio(p);
                  }}
                />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PortfolioItem({
  portfolio,
  onLoad,
}: {
  portfolio: SavedExplainPortfolio;
  onLoad: (portfolio: SavedExplainPortfolio) => void;
}) {
  const { t } = useT();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(portfolio.name);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const handleRename = () => {
    const next = editName.trim();
    if (next && next !== portfolio.name) {
      renameSavedExplainPortfolio(portfolio.id, next);
      toast.success(t("explain.saved.toast.renamed"));
    }
    setIsEditing(false);
  };

  const positionCount = portfolio.workspace.positions.length;

  return (
    <div
      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
      data-testid={`explain-saved-item-${portfolio.id}`}
    >
      <div className="flex-1 min-w-0 pr-4">
        <div className="flex items-center gap-2 mb-1">
          {isEditing ? (
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              className="h-7 py-1 px-2 text-sm max-w-[200px]"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{portfolio.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsEditing(true)}
                title={t("explain.saved.row.rename")}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{format(new Date(portfolio.createdAt), "MMM d, yyyy")}</span>
          <span>&bull;</span>
          <Badge variant="secondary" className="text-[10px] py-0 h-4">
            {t(`risk.${portfolio.workspace.riskAppetite}`)} &bull;{" "}
            {portfolio.workspace.baseCurrency}
          </Badge>
          <span>&bull;</span>
          <span>
            {t("explain.saved.row.positions").replace(
              "{n}",
              String(positionCount),
            )}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onLoad(portfolio)}
          title={t("explain.saved.row.load")}
          data-testid={`explain-saved-load-${portfolio.id}`}
        >
          <Play className="h-4 w-4 text-primary" />
        </Button>
        <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title={t("explain.saved.delete.submit")}
              data-testid={`explain-saved-delete-${portfolio.id}`}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("explain.saved.delete.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("explain.saved.delete.desc").replace(
                  "{name}",
                  portfolio.name,
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("explain.saved.delete.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => {
                  deleteSavedExplainPortfolio(portfolio.id);
                  toast.success(t("explain.saved.toast.deleted"));
                }}
              >
                {t("explain.saved.delete.submit")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
