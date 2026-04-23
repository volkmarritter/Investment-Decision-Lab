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

export interface CompareSlots {
  getInputA: () => PortfolioInput;
  getInputB: () => PortfolioInput;
  onLoadA: (input: PortfolioInput) => void;
  onLoadB: (input: PortfolioInput) => void;
  hasGeneratedA: boolean;
  hasGeneratedB: boolean;
}

export function SavedScenariosUI({
  hasGenerated,
  getCurrentInput,
  onLoadScenario,
  compareSlots,
}: {
  hasGenerated?: boolean;
  getCurrentInput?: () => PortfolioInput;
  onLoadScenario?: (input: PortfolioInput) => void;
  compareSlots?: CompareSlots;
}) {
  const { t, lang } = useT();
  const { scenarios } = useSavedScenarios();
  const [isSaveOpen, setIsSaveOpen] = useState<false | "single" | "A" | "B">(false);
  const [saveName, setSaveName] = useState("");

  const [isListOpen, setIsListOpen] = useState(false);

  const openSaveDialog = (mode: "single" | "A" | "B") => {
    const suffix = mode === "A" ? " A" : mode === "B" ? " B" : "";
    setSaveName(`${t("saved.save.placeholder")} ${scenarios.length + 1}${suffix}`);
    setIsSaveOpen(mode);
  };

  const handleSave = () => {
    if (!saveName.trim() || isSaveOpen === false) return;
    let input: PortfolioInput | undefined;
    if (isSaveOpen === "single" && getCurrentInput) input = getCurrentInput();
    else if (isSaveOpen === "A" && compareSlots) input = compareSlots.getInputA();
    else if (isSaveOpen === "B" && compareSlots) input = compareSlots.getInputB();
    if (!input) return;
    saveScenario(saveName.trim(), input);
    toast.success(t("saved.toast.saved"));
    setIsSaveOpen(false);
    setSaveName("");
  };

  const labelA = lang === "de" ? "Portfolio A speichern" : "Save Portfolio A";
  const labelB = lang === "de" ? "Portfolio B speichern" : "Save Portfolio B";

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2">
      {/* Save button(s) */}
      {compareSlots ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={!compareSlots.hasGeneratedA}
            onClick={() => openSaveDialog("A")}
          >
            <Save className="h-4 w-4 mr-2" />
            {labelA}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!compareSlots.hasGeneratedB}
            onClick={() => openSaveDialog("B")}
          >
            <Save className="h-4 w-4 mr-2" />
            {labelB}
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={!hasGenerated}
          onClick={() => openSaveDialog("single")}
        >
          <Save className="h-4 w-4 mr-2" />
          {t("saved.btn.save")}
        </Button>
      )}

      {/* Save dialog (shared across modes) */}
      <Dialog open={isSaveOpen !== false} onOpenChange={(open) => !open && setIsSaveOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isSaveOpen === "A" ? labelA : isSaveOpen === "B" ? labelB : t("saved.save.title")}
            </DialogTitle>
            <DialogDescription>{t("saved.save.desc")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t("saved.save.placeholder")}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveOpen(false)}>{t("saved.save.cancel")}</Button>
            <Button onClick={handleSave} disabled={!saveName.trim()}>{t("saved.save.submit")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* List dialog */}
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
                  onLoadSingle={
                    onLoadScenario && !compareSlots
                      ? (input) => {
                          setIsListOpen(false);
                          onLoadScenario(input);
                        }
                      : undefined
                  }
                  onLoadA={
                    compareSlots
                      ? (input) => {
                          setIsListOpen(false);
                          compareSlots.onLoadA(input);
                        }
                      : undefined
                  }
                  onLoadB={
                    compareSlots
                      ? (input) => {
                          setIsListOpen(false);
                          compareSlots.onLoadB(input);
                        }
                      : undefined
                  }
                />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScenarioItem({
  scenario,
  onLoadSingle,
  onLoadA,
  onLoadB,
}: {
  scenario: SavedScenario;
  onLoadSingle?: (input: PortfolioInput) => void;
  onLoadA?: (input: PortfolioInput) => void;
  onLoadB?: (input: PortfolioInput) => void;
}) {
  const { t, lang } = useT();
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

  const loadIntoLabel = lang === "de" ? "Laden in" : "Load into";

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
        {onLoadSingle && (
          <Button variant="ghost" size="icon" onClick={() => onLoadSingle(scenario.input)} title={loadIntoLabel}>
            <Play className="h-4 w-4 text-primary" />
          </Button>
        )}
        {onLoadA && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => onLoadA(scenario.input)}
            title={`${loadIntoLabel} Portfolio A`}
          >
            <Play className="h-3 w-3" />A
          </Button>
        )}
        {onLoadB && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => onLoadB(scenario.input)}
            title={`${loadIntoLabel} Portfolio B`}
          >
            <Play className="h-3 w-3" />B
          </Button>
        )}
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
