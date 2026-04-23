import { useState } from "react";
import { format } from "date-fns";
import { Save, Bookmark, Trash2, Play, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { PortfolioInput } from "@/lib/types";
import { useSavedScenarios, saveScenario, deleteScenario, renameScenario, SavedScenario } from "@/lib/savedScenarios";
import { useT } from "@/lib/i18n";

export function SavedScenariosUI({
  hasGenerated,
  getCurrentInput,
  onLoadScenario,
}: {
  hasGenerated: boolean;
  getCurrentInput: () => PortfolioInput;
  onLoadScenario: (input: PortfolioInput) => void;
}) {
  const { t } = useT();
  const { scenarios } = useSavedScenarios();
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const [isListOpen, setIsListOpen] = useState(false);

  const handleSave = () => {
    if (!saveName.trim()) return;
    saveScenario(saveName.trim(), getCurrentInput());
    toast.success(t("saved.toast.saved"));
    setIsSaveOpen(false);
    setSaveName("");
  };

  return (
    <div className="flex items-center gap-2 mt-2">
      <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasGenerated}
          onClick={() => {
            setSaveName(`${t("saved.save.placeholder")} ${scenarios.length + 1}`);
            setIsSaveOpen(true);
          }}
        >
          <Save className="h-4 w-4 mr-2" />
          {t("saved.btn.save")}
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("saved.save.title")}</DialogTitle>
            <DialogDescription>{t("saved.save.desc")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t("saved.save.placeholder")}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveOpen(false)}>{t("saved.save.cancel")}</Button>
            <Button onClick={handleSave} disabled={!saveName.trim()}>{t("saved.save.submit")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isListOpen} onOpenChange={setIsListOpen}>
        <Button variant="outline" size="sm" onClick={() => setIsListOpen(true)}>
          <Bookmark className="h-4 w-4 mr-2" />
          {t("saved.btn.saved").replace("{count}", String(scenarios.length))}
        </Button>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("saved.list.title")}</DialogTitle>
            <DialogDescription>{t("saved.list.desc")}</DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar space-y-3">
            {scenarios.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-muted/20">
                <Bookmark className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                <p className="text-sm font-medium">{t("saved.empty.title")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("saved.empty.desc")}</p>
              </div>
            ) : (
              scenarios.map((scenario) => (
                <ScenarioItem
                  key={scenario.id}
                  scenario={scenario}
                  onLoad={(input) => {
                    setIsListOpen(false);
                    onLoadScenario(input);
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

function ScenarioItem({ scenario, onLoad }: { scenario: SavedScenario; onLoad: (input: PortfolioInput) => void }) {
  const { t } = useT();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(scenario.name);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);

  const handleRename = () => {
    if (editName.trim() && editName.trim() !== scenario.name) {
      renameScenario(scenario.id, editName.trim());
      toast.success(t("saved.toast.renamed"));
    }
    setIsEditing(false);
  };

  return (
    <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
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
              <span className="font-medium truncate">{scenario.name}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsEditing(true)}>
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{format(new Date(scenario.createdAt), "MMM d, yyyy")}</span>
          <span>&bull;</span>
          <Badge variant="secondary" className="text-[10px] py-0 h-4">
            {t(`risk.${scenario.input.riskAppetite}`)} &bull; {scenario.input.baseCurrency}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => onLoad(scenario.input)} title={t("saved.btn.save")}>
          <Play className="h-4 w-4 text-primary" />
        </Button>
        <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" title={t("saved.delete.submit")}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("saved.delete.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("saved.delete.desc").replace("{name}", scenario.name)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("saved.delete.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => {
                  deleteScenario(scenario.id);
                  toast.success(t("saved.toast.deleted"));
                }}
              >
                {t("saved.delete.submit")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
