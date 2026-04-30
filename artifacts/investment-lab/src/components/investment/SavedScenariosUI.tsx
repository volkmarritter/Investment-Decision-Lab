import { useRef, useState } from "react";
import { format } from "date-fns";
import { Save, Bookmark, Trash2, Play, Pencil, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { PortfolioInput } from "@/lib/types";
import { useSavedScenarios, saveScenario, deleteScenario, renameScenario, listSaved, SavedScenario } from "@/lib/savedScenarios";
import type { ManualWeights } from "@/lib/manualWeights";
import type { ETFSlot } from "@/lib/etfSelection";
import { useT } from "@/lib/i18n";
import {
  buildScenarioForExport,
  downloadScenarioAsFile,
  parsePortfolioFile,
  readFileAsText,
  type ImportError,
} from "@/lib/portfolioFile";

export interface CompareSlots {
  getInputA: () => PortfolioInput;
  getInputB: () => PortfolioInput;
  /** Custom-weights snapshot currently associated with slot A (or undefined). */
  getSnapshotA?: () => ManualWeights | undefined;
  /** Custom-weights snapshot currently associated with slot B (or undefined). */
  getSnapshotB?: () => ManualWeights | undefined;
  /** Per-bucket ETF picker snapshot currently associated with slot A (or undefined). */
  getEtfSelectionsA?: () => Record<string, ETFSlot> | undefined;
  /** Per-bucket ETF picker snapshot currently associated with slot B (or undefined). */
  getEtfSelectionsB?: () => Record<string, ETFSlot> | undefined;
  onLoadA: (scenario: SavedScenario) => void;
  onLoadB: (scenario: SavedScenario) => void;
  hasGeneratedA: boolean;
  hasGeneratedB: boolean;
}

// Append "(imported)" to a name if it collides with an existing saved
// scenario, so re-importing the same file twice doesn't silently overwrite.
function uniqueImportedName(name: string, existing: SavedScenario[]): string {
  const taken = new Set(existing.map((s) => s.name));
  if (!taken.has(name)) return name;
  const tagged = `${name} (imported)`;
  if (!taken.has(tagged)) return tagged;
  let n = 2;
  while (taken.has(`${tagged} ${n}`)) n++;
  return `${tagged} ${n}`;
}

function importErrorMessage(
  err: ImportError,
  t: (key: string) => string,
): string {
  if (err.reason === "invalid-input" && err.detail) {
    return t("saved.file.toast.error.engine").replace("{detail}", err.detail);
  }
  return t("saved.file.toast.error.invalid");
}

export function SavedScenariosUI({
  hasGenerated,
  getCurrentInput,
  getCurrentManualWeights,
  getCurrentETFSelections,
  onLoadScenario,
  compareSlots,
}: {
  hasGenerated?: boolean;
  getCurrentInput?: () => PortfolioInput;
  /** Active Build-tab custom weights to snapshot when the user saves. */
  getCurrentManualWeights?: () => ManualWeights | undefined;
  /** Active Build-tab ETF picker selections to snapshot when the user saves. */
  getCurrentETFSelections?: () => Record<string, ETFSlot> | undefined;
  onLoadScenario?: (scenario: SavedScenario) => void;
  compareSlots?: CompareSlots;
}) {
  const { t, lang } = useT();
  const { scenarios } = useSavedScenarios();
  const [isSaveOpen, setIsSaveOpen] = useState<false | "single" | "A" | "B">(false);
  const [saveName, setSaveName] = useState("");

  const [isListOpen, setIsListOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // When in Compare context, an imported scenario needs to be routed into A
  // or B. We hold it in state and ask the user which slot to load it into.
  const [pendingImport, setPendingImport] = useState<SavedScenario | null>(null);

  const openSaveDialog = (mode: "single" | "A" | "B") => {
    const suffix = mode === "A" ? " A" : mode === "B" ? " B" : "";
    setSaveName(`${t("saved.save.placeholder")} ${scenarios.length + 1}${suffix}`);
    setIsSaveOpen(mode);
  };

  const handleSave = () => {
    if (!saveName.trim() || isSaveOpen === false) return;
    let input: PortfolioInput | undefined;
    let manualWeights: ManualWeights | undefined;
    let etfSelections: Record<string, ETFSlot> | undefined;
    if (isSaveOpen === "single" && getCurrentInput) {
      input = getCurrentInput();
      manualWeights = getCurrentManualWeights?.();
      etfSelections = getCurrentETFSelections?.();
    } else if (isSaveOpen === "A" && compareSlots) {
      input = compareSlots.getInputA();
      manualWeights = compareSlots.getSnapshotA?.();
      etfSelections = compareSlots.getEtfSelectionsA?.();
    } else if (isSaveOpen === "B" && compareSlots) {
      input = compareSlots.getInputB();
      manualWeights = compareSlots.getSnapshotB?.();
      etfSelections = compareSlots.getEtfSelectionsB?.();
    }
    if (!input) return;
    saveScenario(saveName.trim(), input, manualWeights, etfSelections);
    toast.success(t("saved.toast.saved"));
    setIsSaveOpen(false);
    setSaveName("");
  };

  // Build a SavedScenario from the *current* state and download it.
  const handleSaveToFile = (mode: "single" | "A" | "B") => {
    let input: PortfolioInput | undefined;
    let manualWeights: ManualWeights | undefined;
    let etfSelections: Record<string, ETFSlot> | undefined;
    let nameSuffix = "";
    if (mode === "single" && getCurrentInput) {
      input = getCurrentInput();
      manualWeights = getCurrentManualWeights?.();
      etfSelections = getCurrentETFSelections?.();
    } else if (mode === "A" && compareSlots) {
      input = compareSlots.getInputA();
      manualWeights = compareSlots.getSnapshotA?.();
      etfSelections = compareSlots.getEtfSelectionsA?.();
      nameSuffix = " A";
    } else if (mode === "B" && compareSlots) {
      input = compareSlots.getInputB();
      manualWeights = compareSlots.getSnapshotB?.();
      etfSelections = compareSlots.getEtfSelectionsB?.();
      nameSuffix = " B";
    }
    if (!input) return;
    const defaultName = `${t("saved.save.placeholder")} ${new Date()
      .toISOString()
      .slice(0, 10)}${nameSuffix}`;
    const scenario = buildScenarioForExport(defaultName, input, manualWeights, etfSelections);
    try {
      downloadScenarioAsFile(scenario);
      toast.success(t("saved.file.toast.exported"));
    } catch (e) {
      console.error(e);
      toast.error(t("saved.file.toast.error.read"));
    }
  };

  // The user picked a file in the native picker. Parse, validate, persist
  // to localStorage, and route into the appropriate slot.
  const handleFileChosen = async (file: File) => {
    let raw: string;
    try {
      raw = await readFileAsText(file);
    } catch {
      toast.error(t("saved.file.toast.error.read"));
      return;
    }
    const result = parsePortfolioFile(raw);
    if (!result.ok) {
      toast.error(importErrorMessage(result.error, t));
      return;
    }
    const finalName = uniqueImportedName(result.scenario.name, listSaved());
    // Persist to the in-browser saved list so it shows up next time.
    const saved = saveScenario(
      finalName,
      result.scenario.input,
      result.scenario.manualWeights,
      result.scenario.etfSelections,
    );

    if (compareSlots) {
      // In Compare context, ask the user which slot to load into.
      setPendingImport(saved);
    } else if (onLoadScenario) {
      onLoadScenario(saved);
      toast.success(t("saved.file.toast.imported"));
    } else {
      toast.success(t("saved.file.toast.imported"));
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so the same file can be re-chosen later (browsers suppress the
    // change event for an identical re-selection otherwise).
    e.target.value = "";
    if (!file) return;
    void handleFileChosen(file);
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
          <Button
            variant="outline"
            size="sm"
            disabled={!compareSlots.hasGeneratedA}
            onClick={() => handleSaveToFile("A")}
            title={t("saved.file.btn.saveA")}
          >
            <Download className="h-4 w-4 mr-2" />
            {t("saved.file.btn.saveA")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!compareSlots.hasGeneratedB}
            onClick={() => handleSaveToFile("B")}
            title={t("saved.file.btn.saveB")}
          >
            <Download className="h-4 w-4 mr-2" />
            {t("saved.file.btn.saveB")}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasGenerated}
            onClick={() => openSaveDialog("single")}
          >
            <Save className="h-4 w-4 mr-2" />
            {t("saved.btn.save")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasGenerated}
            onClick={() => handleSaveToFile("single")}
            title={t("saved.file.btn.save")}
          >
            <Download className="h-4 w-4 mr-2" />
            {t("saved.file.btn.save")}
          </Button>
        </>
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
                      ? (s) => {
                          setIsListOpen(false);
                          onLoadScenario(s);
                        }
                      : undefined
                  }
                  onLoadA={
                    compareSlots
                      ? (s) => {
                          setIsListOpen(false);
                          compareSlots.onLoadA(s);
                        }
                      : undefined
                  }
                  onLoadB={
                    compareSlots
                      ? (s) => {
                          setIsListOpen(false);
                          compareSlots.onLoadB(s);
                        }
                      : undefined
                  }
                />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Load-from-file button + native file picker */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        title={t("saved.file.btn.load")}
      >
        <Upload className="h-4 w-4 mr-2" />
        {t("saved.file.btn.load")}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onFileInputChange}
      />

      {/* Compare-context A/B picker shown after a successful import */}
      {compareSlots && (
        <Dialog
          open={pendingImport !== null}
          onOpenChange={(open) => !open && setPendingImport(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("saved.file.target.title")}</DialogTitle>
              <DialogDescription>{t("saved.file.target.desc")}</DialogDescription>
            </DialogHeader>
            <div className="py-2">
              {pendingImport && (
                <div className="text-sm font-medium truncate">{pendingImport.name}</div>
              )}
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => setPendingImport(null)}>
                {t("saved.file.target.cancel")}
              </Button>
              <Button
                onClick={() => {
                  if (pendingImport) {
                    compareSlots.onLoadA(pendingImport);
                    toast.success(t("saved.file.toast.imported"));
                  }
                  setPendingImport(null);
                }}
              >
                {t("saved.file.target.A")}
              </Button>
              <Button
                onClick={() => {
                  if (pendingImport) {
                    compareSlots.onLoadB(pendingImport);
                    toast.success(t("saved.file.toast.imported"));
                  }
                  setPendingImport(null);
                }}
              >
                {t("saved.file.target.B")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
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
  onLoadSingle?: (scenario: SavedScenario) => void;
  onLoadA?: (scenario: SavedScenario) => void;
  onLoadB?: (scenario: SavedScenario) => void;
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

  const handleDownload = () => {
    try {
      downloadScenarioAsFile(scenario);
      toast.success(t("saved.file.toast.exported"));
    } catch (e) {
      console.error(e);
      toast.error(t("saved.file.toast.error.read"));
    }
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
          <Button variant="ghost" size="icon" onClick={() => onLoadSingle(scenario)} title={loadIntoLabel}>
            <Play className="h-4 w-4 text-primary" />
          </Button>
        )}
        {onLoadA && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => onLoadA(scenario)}
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
            onClick={() => onLoadB(scenario)}
            title={`${loadIntoLabel} Portfolio B`}
          >
            <Play className="h-3 w-3" />B
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDownload}
          title={t("saved.file.row.download")}
        >
          <Download className="h-4 w-4" />
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
