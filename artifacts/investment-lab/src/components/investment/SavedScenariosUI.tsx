import { useState } from "react";
import { format } from "date-fns";
import { Save, Bookmark, BookmarkCheck, Trash2, Play, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { PortfolioInput } from "@/lib/types";
import { useSavedScenarios, saveScenario, deleteScenario, renameScenario, SavedScenario } from "@/lib/savedScenarios";

export function SavedScenariosUI({
  hasGenerated,
  getCurrentInput,
  onLoadScenario,
}: {
  hasGenerated: boolean;
  getCurrentInput: () => PortfolioInput;
  onLoadScenario: (input: PortfolioInput) => void;
}) {
  const { scenarios } = useSavedScenarios();
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const [isListOpen, setIsListOpen] = useState(false);

  const handleSave = () => {
    if (!saveName.trim()) return;
    saveScenario(saveName.trim(), getCurrentInput());
    toast.success("Scenario saved");
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
            setSaveName(`Scenario ${scenarios.length + 1}`);
            setIsSaveOpen(true);
          }}
        >
          <Save className="h-4 w-4 mr-2" />
          Save Scenario
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Scenario</DialogTitle>
            <DialogDescription>Save your current portfolio configuration to revisit later.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Scenario Name"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!saveName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isListOpen} onOpenChange={setIsListOpen}>
        <Button variant="outline" size="sm" onClick={() => setIsListOpen(true)}>
          <Bookmark className="h-4 w-4 mr-2" />
          Saved ({scenarios.length})
        </Button>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Saved Scenarios</DialogTitle>
            <DialogDescription>Load or manage your saved portfolio configurations.</DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar space-y-3">
            {scenarios.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-muted/20">
                <Bookmark className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                <p className="text-sm font-medium">No saved scenarios yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Generate a portfolio and click Save Scenario.</p>
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
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(scenario.name);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);

  const handleRename = () => {
    if (editName.trim() && editName.trim() !== scenario.name) {
      renameScenario(scenario.id, editName.trim());
      toast.success("Scenario renamed");
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
            {scenario.input.riskAppetite} &bull; {scenario.input.baseCurrency}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => onLoad(scenario.input)} title="Load Scenario">
          <Play className="h-4 w-4 text-primary" />
        </Button>
        <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" title="Delete Scenario">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Scenario?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the scenario "{scenario.name}".
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => {
                  deleteScenario(scenario.id);
                  toast.success("Scenario deleted");
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
