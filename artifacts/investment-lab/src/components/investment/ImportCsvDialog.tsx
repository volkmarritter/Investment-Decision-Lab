import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertCircle, XCircle, CheckCircle } from "lucide-react";
import { parsePositionsCsv, CsvParseResult, ParsedPositionRow } from "@/lib/csvImport";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ImportCsvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: ParsedPositionRow[], append: boolean) => void;
}

export function ImportCsvDialog({ open, onOpenChange, onImport }: ImportCsvDialogProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<CsvParseResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setText("");
      setResult(null);
    }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (text) {
        setResult(parsePositionsCsv(text));
      } else {
        setResult(null);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [text]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string") {
        setText(content);
      }
    };
    reader.readAsText(file);
  };

  const hasBlockingErrors = result && result.errors.length > 0;
  const canImport = result && !hasBlockingErrors && result.rows.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import positions from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file or paste the text below. Requires "Asset Class", "Region", and "Weight" columns.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="paste" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="paste">Paste CSV</TabsTrigger>
            <TabsTrigger value="upload">Upload file</TabsTrigger>
          </TabsList>
          
          <TabsContent value="paste">
            <Textarea 
              placeholder="Asset Class,Region,Weight&#10;Equities,USA,40&#10;Equities,Europe,20&#10;Bonds,Global,40"
              className="min-h-[200px] font-mono text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </TabsContent>
          
          <TabsContent value="upload">
            <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-12 bg-muted/20 text-center min-h-[200px]">
              <Input 
                type="file" 
                accept=".csv,.txt" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <Button onClick={() => fileInputRef.current?.click()} variant="outline">
                Select CSV File
              </Button>
              <p className="text-sm text-muted-foreground mt-2">
                Accepts .csv or .txt files
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {result && (
          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {result.rows.length} row{result.rows.length !== 1 ? 's' : ''} parsed successfully
              </span>
              {canImport && <CheckCircle className="h-4 w-4 text-primary" />}
            </div>

            {(result.errors.length > 0 || result.warnings.length > 0) && (
              <ScrollArea className="h-32 rounded-md border p-2">
                {result.errors.length > 0 && (
                  <div className="mb-2">
                    <h4 className="text-sm font-semibold flex items-center gap-1 text-destructive mb-1">
                      <XCircle className="h-4 w-4" /> Errors (Blocking)
                    </h4>
                    <ul className="list-disc pl-5 space-y-1">
                      {result.errors.map((err, i) => (
                        <li key={i} className="text-xs text-destructive">{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.warnings.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold flex items-center gap-1 text-warning mb-1">
                      <AlertCircle className="h-4 w-4" /> Warnings (Non-blocking)
                    </h4>
                    <ul className="list-disc pl-5 space-y-1">
                      {result.warnings.map((warn, i) => (
                        <li key={i} className="text-xs text-warning">{warn}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            variant="secondary" 
            disabled={!canImport}
            onClick={() => {
              if (result) {
                onImport(result.rows, true);
                onOpenChange(false);
              }
            }}
          >
            Import (append)
          </Button>
          <Button 
            disabled={!canImport}
            onClick={() => {
              if (result) {
                onImport(result.rows, false);
                onOpenChange(false);
              }
            }}
          >
            Import (replace)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
