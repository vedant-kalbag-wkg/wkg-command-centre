"use client";

import * as React from "react";
import { CheckIcon, Loader2 } from "lucide-react";
import {
  exploreBoardColumns,
  detectSplits,
  runDryImport,
  runFullImport,
  getImportProgress,
  loadBoardIds,
  saveBoardIds,
} from "./actions";
import type { FieldMapping, ImportPreview, ImportProgress, SplitDecision, MergeConflict } from "@/lib/field-mapper";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";

// =============================================================================
// Types
// =============================================================================

type Step =
  | "connect"
  | "fetching"
  | "mapping"
  | "splitting"
  | "preview"
  | "importing"
  | "complete";

// Which board is being used for a single/individual import
type ActiveBoard = "kiosks" | "hotels" | "configGroups";

// =============================================================================
// Target field options for mapping dropdowns
// =============================================================================

const TARGET_FIELD_OPTIONS: Array<{ value: string; label: string; table: "kiosk" | "location" | null }> = [
  { value: "skip", label: "Skip (unmapped)", table: null },
  // Kiosk fields
  { value: "kiosk:kioskId", label: "Kiosk — Kiosk ID", table: "kiosk" },
  { value: "kiosk:outletCode", label: "Kiosk — Outlet Code", table: "kiosk" },
  { value: "location:customerCode", label: "Location — Customer Code", table: "location" },
  { value: "kiosk:hardwareModel", label: "Kiosk — Hardware Model", table: "kiosk" },
  { value: "kiosk:softwareVersion", label: "Kiosk — Software Version", table: "kiosk" },
  { value: "kiosk:cmsConfigStatus", label: "Kiosk — CMS Config Status", table: "kiosk" },
  { value: "kiosk:installationDate", label: "Kiosk — Installation Date", table: "kiosk" },
  { value: "kiosk:maintenanceFee", label: "Kiosk — Maintenance Fee", table: "kiosk" },
  { value: "kiosk:freeTrialEndDate", label: "Kiosk — Free Trial End Date", table: "kiosk" },
  { value: "kiosk:regionGroup", label: "Kiosk — Region / Group", table: "kiosk" },
  { value: "kiosk:deploymentPhaseTags", label: "Kiosk — Deployment Phase Tags", table: "kiosk" },
  { value: "kiosk:notes", label: "Kiosk — Notes", table: "kiosk" },
  // Location fields
  { value: "location:name", label: "Location — Hotel Name", table: "location" },
  { value: "location:address", label: "Location — Address", table: "location" },
  { value: "location:city", label: "Location — City", table: "location" },
  { value: "location:country", label: "Location — Country", table: "location" },
  { value: "location:starRating", label: "Location — Star Rating", table: "location" },
  { value: "location:roomCount", label: "Location — Room Count", table: "location" },
  { value: "location:hotelGroup", label: "Location — Hotel Group", table: "location" },
  { value: "location:sourcedBy", label: "Location — Sourced By", table: "location" },
  { value: "location:contractValue", label: "Location — Contract Value", table: "location" },
  { value: "location:contractStartDate", label: "Location — Contract Start Date", table: "location" },
  { value: "location:contractEndDate", label: "Location — Contract End Date", table: "location" },
  { value: "location:contractTerms", label: "Location — Contract Terms", table: "location" },
  { value: "location:bankingDetails", label: "Location — Banking Details", table: "location" },
  { value: "location:maintenanceFee", label: "Location — Maintenance Fee", table: "location" },
  { value: "location:freeTrialEndDate", label: "Location — Free Trial End Date", table: "location" },
  { value: "location:hardwareAssets", label: "Location — Hardware Assets", table: "location" },
  { value: "location:_subitems", label: "Location — Products / Commissions (subitems)", table: "location" },
  { value: "location:notes", label: "Location — Notes", table: "location" },
  { value: "location:keyContactName", label: "Location — Key Contact Name", table: "location" },
  { value: "location:keyContactEmail", label: "Location — Key Contact Email", table: "location" },
  { value: "location:additionalContactEmail", label: "Location — Additional Contact Email", table: "location" },
  { value: "location:financeContact", label: "Location — Finance Contact", table: "location" },
];

// =============================================================================
// Step indicator
// =============================================================================

function StepIndicator({ step }: { step: Step }) {
  const steps: Array<{ id: number; label: string; activeOn: Step[] }> = [
    { id: 1, label: "Connect Board", activeOn: ["connect", "fetching"] },
    { id: 2, label: "Review Mapping", activeOn: ["mapping"] },
    { id: 3, label: "Review Splits", activeOn: ["splitting"] },
    { id: 4, label: "Preview & Import", activeOn: ["preview", "importing", "complete"] },
  ];

  const currentStepIdx = steps.findIndex((s) => s.activeOn.includes(step));

  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, idx) => {
        const isActive = s.activeOn.includes(step);
        const isComplete = idx < currentStepIdx;

        return (
          <React.Fragment key={s.id}>
            <div
              className={[
                "flex items-center gap-2 px-4 py-2 border-b-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-wk-azure text-wk-azure"
                  : isComplete
                  ? "border-wk-azure/40 text-wk-night-grey"
                  : "border-transparent text-wk-mid-grey",
              ].join(" ")}
            >
              {isComplete ? (
                <CheckIcon className="w-4 h-4 text-wk-azure" />
              ) : (
                <span
                  className={[
                    "flex items-center justify-center w-5 h-5 rounded-full text-xs border",
                    isActive
                      ? "border-wk-azure bg-wk-azure text-white"
                      : "border-wk-mid-grey text-wk-mid-grey",
                  ].join(" ")}
                >
                  {s.id}
                </span>
              )}
              {s.label}
            </div>
            {idx < steps.length - 1 && (
              <div className="flex-1 h-px bg-wk-mid-grey/30 mx-1" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// =============================================================================
// Mapping status badge
// =============================================================================

function MappingStatusBadge({ status }: { status: FieldMapping["status"] }) {
  if (status === "mapped") {
    return <Badge variant="default">Mapped</Badge>;
  }
  return <Badge variant="outline">Unmapped</Badge>;
}

// =============================================================================
// Log entry component
// =============================================================================

function LogEntry({
  entry,
}: {
  entry: { timestamp: string; level: "info" | "warn" | "error"; message: string };
}) {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const colorClass =
    entry.level === "error"
      ? "text-wk-destructive"
      : entry.level === "warn"
      ? "text-amber-600"
      : "text-wk-night-grey";

  return (
    <div className={`text-sm font-mono ${colorClass} py-0.5`}>
      <span className="text-wk-mid-grey mr-2">{time}</span>
      {entry.message}
    </div>
  );
}

// =============================================================================
// Import sub-step indicator (Step N of 3)
// =============================================================================

function ImportSubStepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Kiosks", "Hotels", "Config Groups"];
  return (
    <div className="flex items-center gap-2 mb-4">
      {labels.map((label, idx) => {
        const stepNum = (idx + 1) as 1 | 2 | 3;
        const isActive = stepNum === step;
        const isComplete = stepNum < step;
        return (
          <React.Fragment key={label}>
            <div
              className={[
                "flex items-center gap-1.5 text-sm font-medium",
                isActive ? "text-wk-azure" : isComplete ? "text-wk-night-grey" : "text-wk-mid-grey",
              ].join(" ")}
            >
              {isComplete ? (
                <CheckIcon className="w-4 h-4 text-wk-azure" />
              ) : (
                <span
                  className={[
                    "flex items-center justify-center w-5 h-5 rounded-full text-xs border",
                    isActive ? "border-wk-azure bg-wk-azure text-white" : "border-wk-mid-grey text-wk-mid-grey",
                  ].join(" ")}
                >
                  {stepNum}
                </span>
              )}
              <span>
                Step {stepNum} of 3 — {label}
              </span>
            </div>
            {idx < labels.length - 1 && (
              <div className="flex-1 h-px bg-wk-mid-grey/30 mx-1" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// =============================================================================
// Merge conflict resolution card
// =============================================================================

function ConflictResolutionCard({
  conflict,
  resolutions,
  onResolve,
}: {
  conflict: MergeConflict;
  resolutions: Map<string, string>; // field -> chosen value
  onResolve: (field: string, value: string) => void;
}) {
  return (
    <Card className="border-[#00A6D380] p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-wk-graphite">{conflict.locationName}</p>
        <p className="text-xs text-wk-night-grey mt-1">
          This hotel name appears in multiple rows. Choose the correct value for each conflicting field.
        </p>
      </div>
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-wk-night-grey mb-2 uppercase tracking-wide">
            Field: {conflict.field}
          </p>
          <div className="space-y-1.5">
            {conflict.values.map((val) => (
              <label
                key={val}
                className={[
                  "flex items-center gap-2.5 rounded-md border px-3 py-2 cursor-pointer text-sm transition-colors",
                  resolutions.get(conflict.field) === val
                    ? "border-wk-azure bg-wk-azure/5 text-wk-graphite"
                    : "border-wk-mid-grey/40 text-wk-night-grey hover:border-wk-mid-grey",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name={`conflict-${conflict.locationName}-${conflict.field}`}
                  value={val}
                  checked={resolutions.get(conflict.field) === val}
                  onChange={() => onResolve(conflict.field, val)}
                  className="accent-wk-azure"
                />
                {val}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// =============================================================================
// Main DataImportClient component
// =============================================================================

interface DataImportClientProps {
  defaultBoardId: string;
}

export function DataImportClient({ defaultBoardId }: DataImportClientProps) {
  const [step, setStep] = React.useState<Step>("connect");

  // Three board ID inputs
  const [boardIds, setBoardIds] = React.useState({
    kiosks: defaultBoardId,
    hotels: "",
    configGroups: "",
  });

  // Track the last successfully saved values for "Saved" badge
  const savedBoardIdsRef = React.useRef({ kiosks: "", hotels: "", configGroups: "" });

  // Which board is actively being imported (for individual imports)
  const [activeBoard, setActiveBoard] = React.useState<ActiveBoard>("kiosks");

  const [mappings, setMappings] = React.useState<FieldMapping[]>([]);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<ImportProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [splitDecisions, setSplitDecisions] = React.useState<SplitDecision[]>([]);
  const [fetchId, setFetchId] = React.useState<string | null>(null);
  const [importMode, setImportMode] = React.useState<"fresh" | "incremental">("incremental");
  const [importStep, setImportStep] = React.useState<1 | 2 | 3>(1);

  // Conflict resolution: Map<locationName, Map<field, chosenValue>>
  const [conflictResolutions, setConflictResolutions] = React.useState<Map<string, Map<string, string>>>(new Map());

  // Log scroll ref for auto-scroll
  const logEndRef = React.useRef<HTMLDivElement>(null);

  // Debounce timer ref for auto-save
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll log to bottom
  React.useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [progress?.log.length]);

  // On mount: load saved board IDs
  React.useEffect(() => {
    loadBoardIds().then((saved) => {
      setBoardIds({
        kiosks: saved.kiosks || defaultBoardId,
        hotels: saved.hotels,
        configGroups: saved.kioskConfigGroups,
      });
      savedBoardIdsRef.current = {
        kiosks: saved.kiosks || defaultBoardId,
        hotels: saved.hotels,
        configGroups: saved.kioskConfigGroups,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save board IDs with debounce
  function handleBoardIdChange(field: keyof typeof boardIds, value: string) {
    setBoardIds((prev) => ({ ...prev, [field]: value }));

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const updated = { ...boardIds, [field]: value };
      const result = await saveBoardIds({
        kiosks: updated.kiosks,
        hotels: updated.hotels,
        kioskConfigGroups: updated.configGroups,
      });
      if ("success" in result) {
        savedBoardIdsRef.current = { ...updated };
      }
    }, 500);
  }

  // Poll import progress
  React.useEffect(() => {
    if (step !== "importing" || !sessionId) return;

    const intervalId = setInterval(async () => {
      const result = await getImportProgress(sessionId);
      if ("error" in result) {
        setError(result.error);
        clearInterval(intervalId);
        return;
      }
      setProgress(result);
      if (result.status === "complete" || result.status === "error") {
        clearInterval(intervalId);
        setStep("complete");
      }
    }, 1500);

    return () => clearInterval(intervalId);
  }, [step, sessionId]);

  // =============================================================================
  // Conflict resolution helpers
  // =============================================================================

  function getConflictResolution(locationName: string, field: string): string | undefined {
    return conflictResolutions.get(locationName)?.get(field);
  }

  function resolveConflict(locationName: string, field: string, value: string) {
    setConflictResolutions((prev) => {
      const next = new Map(prev);
      const locationMap = new Map(next.get(locationName) ?? []);
      locationMap.set(field, value);
      next.set(locationName, locationMap);
      return next;
    });
  }

  // Count unresolved conflicts
  function unresolvedConflictsCount(): number {
    if (!preview?.conflicts?.length) return 0;
    let count = 0;
    for (const conflict of preview.conflicts) {
      if (!getConflictResolution(conflict.locationName, conflict.field)) {
        count++;
      }
    }
    return count;
  }

  // Build conflict resolutions as plain Record for server action
  function buildConflictResolutionsRecord(): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const [locationName, fieldMap] of conflictResolutions.entries()) {
      result[locationName] = Object.fromEntries(fieldMap.entries());
    }
    return result;
  }

  // =============================================================================
  // Handlers
  // =============================================================================

  async function handleConnectBoard(board: ActiveBoard = "kiosks") {
    const boardId = board === "kiosks"
      ? boardIds.kiosks
      : board === "hotels"
      ? boardIds.hotels
      : boardIds.configGroups;

    if (!boardId.trim()) {
      setError("Enter a board ID to continue. Find it in your Monday.com board URL.");
      return;
    }
    setActiveBoard(board);
    setError(null);
    setStep("fetching");

    const result = await exploreBoardColumns(boardId.trim());
    if ("error" in result) {
      setError(result.error);
      setStep("connect");
      return;
    }

    setMappings(result.mappings);
    setStep("mapping");
  }

  function handleMappingChange(columnId: string, newValue: string | null) {
    if (!newValue) return;
    setMappings((prev) =>
      prev.map((m) => {
        if (m.mondayColumnId !== columnId) return m;
        if (newValue === "skip") {
          return { ...m, targetTable: null, targetField: null, status: "unmapped" };
        }
        const [table, field] = newValue.split(":") as ["kiosk" | "location", string];
        return { ...m, targetTable: table, targetField: field, status: "mapped" };
      })
    );
  }

  function getMappingValue(m: FieldMapping): string {
    if (!m.targetTable || !m.targetField) return "skip";
    return `${m.targetTable}:${m.targetField}`;
  }

  function getActiveBoardId(): string {
    if (activeBoard === "kiosks") return boardIds.kiosks;
    if (activeBoard === "hotels") return boardIds.hotels;
    return boardIds.configGroups;
  }

  async function handleDetectSplits() {
    setError(null);
    setStep("fetching");

    const boardId = getActiveBoardId();
    const result = await detectSplits(boardId.trim(), mappings);
    if ("error" in result) {
      setError(result.error);
      setStep("mapping");
      return;
    }

    setFetchId(result.fetchId);

    if (result.splits.length > 0) {
      setSplitDecisions(result.splits);
      setStep("splitting");
    } else {
      // No splits needed — go directly to dry run
      await handleRunDryImport(result.fetchId);
    }
  }

  async function handleRunDryImport(fId?: string) {
    setError(null);
    setStep("fetching");

    const boardId = getActiveBoardId();
    const result = await runDryImport(
      boardId.trim(),
      mappings,
      splitDecisions.length > 0 ? splitDecisions : undefined,
      fId ?? fetchId ?? undefined
    );
    if ("error" in result) {
      setError(result.error);
      setStep(splitDecisions.length > 0 ? "splitting" : "mapping");
      return;
    }

    setPreview(result.preview);
    setConflictResolutions(new Map()); // reset conflict resolutions for fresh preview
    setStep("preview");
  }

  function handleSplitDecisionChange(itemId: string, decision: string) {
    setSplitDecisions((prev) =>
      prev.map((sd) =>
        sd.mondayItemId === itemId
          ? { ...sd, decision: decision as "split" | "keep" }
          : sd
      )
    );
  }

  async function handleConfirmImport() {
    setShowConfirm(false);
    setError(null);
    setImportStep(1);

    const conflictResolutionsRecord = buildConflictResolutionsRecord();

    const result = await runFullImport(
      getActiveBoardId().trim(),
      mappings,
      splitDecisions.length > 0 ? splitDecisions : undefined,
      fetchId ?? undefined,
      importMode,
      Object.keys(conflictResolutionsRecord).length > 0 ? conflictResolutionsRecord : undefined
    );
    if ("error" in result) {
      setError(result.error);
      return;
    }

    setSessionId(result.sessionId);
    setProgress({
      sessionId: result.sessionId,
      status: "running",
      current: 0,
      total: preview?.totalItems ?? 0,
      log: [],
    });
    setStep("importing");
  }

  async function handleSequentialImport() {
    setShowConfirm(false);
    setError(null);
    setStep("importing");

    const conflictResolutionsRecord = buildConflictResolutionsRecord();

    // Step 1: Kiosks
    setImportStep(1);
    if (boardIds.kiosks.trim()) {
      const r1 = await runFullImport(
        boardIds.kiosks.trim(),
        mappings,
        splitDecisions.length > 0 ? splitDecisions : undefined,
        fetchId ?? undefined,
        importMode,
        Object.keys(conflictResolutionsRecord).length > 0 ? conflictResolutionsRecord : undefined
      );
      if ("error" in r1) {
        setError(`Import stopped at step 1. Check your Monday.com API key and board permissions, then try again.`);
        setStep("preview");
        return;
      }
      setSessionId(r1.sessionId);
      setProgress({ sessionId: r1.sessionId, status: "running", current: 0, total: preview?.totalItems ?? 0, log: [] });
      // Poll until complete
      await pollUntilComplete(r1.sessionId);
    }

    // Step 2: Hotels
    setImportStep(2);
    if (boardIds.hotels.trim()) {
      const r2 = await runFullImport(boardIds.hotels.trim(), mappings, undefined, undefined, importMode);
      if ("error" in r2) {
        setError(`Import stopped at step 2. Check your Monday.com API key and board permissions, then try again.`);
        setStep("preview");
        return;
      }
      setSessionId(r2.sessionId);
      setProgress({ sessionId: r2.sessionId, status: "running", current: 0, total: 0, log: [] });
      await pollUntilComplete(r2.sessionId);
    }

    // Step 3: Config Groups
    setImportStep(3);
    if (boardIds.configGroups.trim()) {
      const r3 = await runFullImport(boardIds.configGroups.trim(), mappings, undefined, undefined, importMode);
      if ("error" in r3) {
        setError(`Import stopped at step 3. Check your Monday.com API key and board permissions, then try again.`);
        setStep("preview");
        return;
      }
      setSessionId(r3.sessionId);
      setProgress({ sessionId: r3.sessionId, status: "running", current: 0, total: 0, log: [] });
      await pollUntilComplete(r3.sessionId);
    }

    setStep("complete");
  }

  async function pollUntilComplete(sid: string): Promise<void> {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const result = await getImportProgress(sid);
        if ("error" in result) {
          clearInterval(interval);
          resolve();
          return;
        }
        setProgress(result);
        if (result.status === "complete" || result.status === "error") {
          clearInterval(interval);
          resolve();
        }
      }, 1500);
    });
  }

  function handleReset() {
    setStep("connect");
    setBoardIds({ kiosks: defaultBoardId, hotels: "", configGroups: "" });
    setMappings([]);
    setPreview(null);
    setSessionId(null);
    setProgress(null);
    setError(null);
    setShowConfirm(false);
    setSplitDecisions([]);
    setFetchId(null);
    setImportMode("incremental");
    setImportStep(1);
    setConflictResolutions(new Map());
    setActiveBoard("kiosks");
  }

  // =============================================================================
  // Render
  // =============================================================================

  const canRunSequential = boardIds.kiosks.trim().length > 0;
  const unresolved = unresolvedConflictsCount();
  const hasConflicts = (preview?.conflicts?.length ?? 0) > 0;
  const importBlocked = hasConflicts && unresolved > 0;

  return (
    <div className="max-w-4xl">
      <StepIndicator step={step} />

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* S1: Initial / Connect — three board ID inputs */}
      {step === "connect" && (
        <div className="space-y-6">
          <div className="space-y-4">
            <p className="text-sm text-wk-night-grey">
              Enter your Monday.com board IDs to connect and preview records for import.
              Board IDs are saved automatically after first entry.
            </p>

            {/* Board ID: Kiosks */}
            <div className="space-y-1.5">
              <label htmlFor="boardId-kiosks" className="text-sm font-medium text-wk-graphite">
                Assets / Kiosks Board ID
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="boardId-kiosks"
                  type="text"
                  value={boardIds.kiosks}
                  onChange={(e) => handleBoardIdChange("kiosks", e.target.value)}
                  placeholder="e.g. 1426737864"
                  className="flex-1 h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                {boardIds.kiosks && boardIds.kiosks === savedBoardIdsRef.current.kiosks && (
                  <Badge className="bg-[#00A6D3] text-white text-xs">Saved</Badge>
                )}
              </div>
            </div>

            {/* Board ID: Hotels */}
            <div className="space-y-1.5">
              <label htmlFor="boardId-hotels" className="text-sm font-medium text-wk-graphite">
                Hotels / Locations Board ID(s)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="boardId-hotels"
                  type="text"
                  value={boardIds.hotels}
                  onChange={(e) => handleBoardIdChange("hotels", e.target.value)}
                  placeholder="Comma-separated board IDs"
                  className="flex-1 h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                {boardIds.hotels && boardIds.hotels === savedBoardIdsRef.current.hotels && (
                  <Badge className="bg-[#00A6D3] text-white text-xs">Saved</Badge>
                )}
              </div>
            </div>

            {/* Board ID: Kiosk Config Groups */}
            <div className="space-y-1.5">
              <label htmlFor="boardId-configGroups" className="text-sm font-medium text-wk-graphite">
                Kiosk Config Groups Board ID
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="boardId-configGroups"
                  type="text"
                  value={boardIds.configGroups}
                  onChange={(e) => handleBoardIdChange("configGroups", e.target.value)}
                  placeholder="e.g. 1466686598"
                  className="flex-1 h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                {boardIds.configGroups && boardIds.configGroups === savedBoardIdsRef.current.configGroups && (
                  <Badge className="bg-[#00A6D3] text-white text-xs">Saved</Badge>
                )}
              </div>
            </div>
          </div>

          {/* Primary CTA: Run Import (sequential) */}
          <div className="flex flex-col gap-3 pt-2">
            <Button
              className="w-fit bg-[#00A6D3] hover:bg-[#0090b8] text-white"
              disabled={!canRunSequential}
              onClick={() => handleConnectBoard("kiosks")}
            >
              Run Import
            </Button>

            {!canRunSequential && (
              <p className="text-xs text-wk-mid-grey">
                Enter a board ID to continue. Find it in your Monday.com board URL.
              </p>
            )}

            {/* Individual import buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!boardIds.kiosks.trim()}
                onClick={() => handleConnectBoard("kiosks")}
              >
                Import Kiosks
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!boardIds.hotels.trim()}
                onClick={() => handleConnectBoard("hotels")}
              >
                Import Hotels
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!boardIds.configGroups.trim()}
                onClick={() => handleConnectBoard("configGroups")}
              >
                Import Config Groups
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* S2: Fetching */}
      {step === "fetching" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-wk-night-grey mb-4">
            <Loader2 className="w-4 h-4 animate-spin text-wk-azure" />
            <span>Fetching board columns…</span>
          </div>
          <div className="rounded-lg border border-wk-mid-grey/40 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monday.com Column</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Target Field</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* S3: Mapping review */}
      {step === "mapping" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-wk-mid-grey/40 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monday.com Column</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Target Field</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((m) => (
                  <TableRow key={m.mondayColumnId}>
                    <TableCell className="font-medium">{m.mondayTitle}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {m.mondayType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <MappingStatusBadge status={m.status} />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={getMappingValue(m)}
                        onValueChange={(val) => handleMappingChange(m.mondayColumnId, val)}
                        items={TARGET_FIELD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      >
                        <SelectTrigger className="w-52">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_FIELD_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end">
            <Button
              variant="outline"
              className="border-wk-azure text-wk-azure hover:bg-wk-sky-blue"
              onClick={handleDetectSplits}
            >
              Run Preview
            </Button>
          </div>
        </div>
      )}

      {/* S3.5: Splitting review */}
      {step === "splitting" && (
        <div className="space-y-6">
          <p className="text-sm text-wk-night-grey">
            {splitDecisions.length} row(s) have comma-separated outlet codes.
            Choose whether to split each into separate kiosk records.
            Rows are pre-selected based on the Number of SSMs column.
          </p>
          <div className="rounded-lg border border-wk-mid-grey/40 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hotel Name</TableHead>
                  <TableHead>Outlet Codes</TableHead>
                  <TableHead>SSM Count</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {splitDecisions.map((sd) => (
                  <TableRow key={sd.mondayItemId}>
                    <TableCell className="font-medium">{sd.mondayItemName}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {sd.outletCodes.map((code, i) => (
                          <Badge key={`${code}-${i}`} variant="outline" className="text-xs">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{sd.ssmCount || "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={sd.decision}
                        onValueChange={(val) =>
                          handleSplitDecisionChange(sd.mondayItemId, val!)
                        }
                        items={[
                          { value: "split", label: "Split into separate kiosks" },
                          { value: "keep", label: "Keep as one kiosk" },
                        ]}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="split">Split into separate kiosks</SelectItem>
                          <SelectItem value="keep">Keep as one kiosk</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep("mapping")}
              className="text-sm text-wk-azure hover:underline"
            >
              Back to mapping
            </button>
            <Button
              variant="outline"
              className="border-wk-azure text-wk-azure hover:bg-wk-sky-blue"
              onClick={() => handleRunDryImport()}
            >
              Run Preview
            </Button>
          </div>
        </div>
      )}

      {/* S4: Dry-run preview */}
      {step === "preview" && preview && (
        <div className="space-y-6">
          {/* Summary stats */}
          <div className="rounded-lg bg-wk-light-grey px-4 py-3 text-sm text-wk-night-grey">
            Preview complete —{" "}
            <strong className="text-wk-graphite">{preview.totalItems}</strong> records found,{" "}
            <strong className="text-wk-graphite">{preview.mappedCount}</strong> mapped,{" "}
            <strong className="text-wk-graphite">{preview.warningCount}</strong> warnings,{" "}
            <strong className="text-wk-graphite">{preview.duplicateCount}</strong> duplicates
          </div>

          {/* New pipeline stages */}
          {preview.newStageNames.length > 0 && (
            <Alert>
              <AlertDescription>
                New pipeline stages will be created:{" "}
                <strong>{preview.newStageNames.join(", ")}</strong>
              </AlertDescription>
            </Alert>
          )}

          {/* Merge conflict resolution */}
          {hasConflicts && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-wk-graphite">
                  Merge conflicts ({preview.conflicts!.length})
                </p>
                {unresolved > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {unresolved} conflict{unresolved !== 1 ? "s" : ""} remaining
                  </Badge>
                )}
              </div>
              <p className="text-xs text-wk-night-grey">
                Resolve all field conflicts before importing. {unresolved} conflict(s) remaining.
              </p>
              <div className="space-y-3">
                {preview.conflicts!.map((conflict) => (
                  <ConflictResolutionCard
                    key={`${conflict.locationName}-${conflict.field}`}
                    conflict={conflict}
                    resolutions={conflictResolutions.get(conflict.locationName) ?? new Map()}
                    onResolve={(field, value) => resolveConflict(conflict.locationName, field, value)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Products and providers */}
          {preview.productNames.length > 0 && (
            <div className="rounded-lg border border-wk-mid-grey/40 p-4 space-y-2">
              <p className="text-sm font-medium text-wk-graphite">
                Products found ({preview.productNames.length})
              </p>
              <p className="text-sm text-wk-night-grey">
                {preview.productNames.join(", ")}
              </p>
              {preview.providerNames.length > 0 && (
                <>
                  <p className="text-sm font-medium text-wk-graphite mt-3">
                    Providers found ({preview.providerNames.length})
                  </p>
                  <p className="text-sm text-wk-night-grey">
                    {preview.providerNames.join(", ")}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Sample records table */}
          <div>
            <p className="text-sm font-medium text-wk-graphite mb-2">
              Sample records (first {preview.sampleRecords.length})
            </p>
            <div className="rounded-lg border border-wk-mid-grey/40 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Monday.com Name</TableHead>
                    <TableHead>Mapped Fields</TableHead>
                    <TableHead>Warnings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sampleRecords.map((rec, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{rec.mondayName}</TableCell>
                      <TableCell className="text-xs text-wk-night-grey">
                        {Object.entries(rec.mappedFields)
                          .filter(([, v]) => v !== undefined && v !== null && v !== "")
                          .slice(0, 4)
                          .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as string[]).join(", ") : String(v)}`)
                          .join(" · ")}
                      </TableCell>
                      <TableCell>
                        {rec.warnings.length > 0 ? (
                          <div className="space-y-0.5">
                            {rec.warnings.map((w, wi) => (
                              <Badge key={wi} variant="secondary" className="text-xs block w-fit">
                                {w}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <Badge variant="default" className="text-xs">Clean</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Import mode selector */}
          <div className="rounded-lg border border-wk-mid-grey/40 p-4 space-y-3">
            <p className="text-sm font-medium text-wk-graphite">Import mode</p>
            <div className="flex gap-3">
              <label
                className={[
                  "flex items-start gap-3 flex-1 rounded-lg border p-3 cursor-pointer transition-colors",
                  importMode === "incremental"
                    ? "border-wk-azure bg-wk-azure/5"
                    : "border-wk-mid-grey/40 hover:border-wk-mid-grey",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="importMode"
                  value="incremental"
                  checked={importMode === "incremental"}
                  onChange={() => setImportMode("incremental")}
                  className="mt-0.5 accent-wk-azure"
                />
                <div>
                  <p className="text-sm font-medium text-wk-graphite">Import new only</p>
                  <p className="text-xs text-wk-night-grey">
                    Skip rows that already exist (match by kiosk ID). Existing data is untouched.
                  </p>
                </div>
              </label>
              <label
                className={[
                  "flex items-start gap-3 flex-1 rounded-lg border p-3 cursor-pointer transition-colors",
                  importMode === "fresh"
                    ? "border-wk-destructive bg-wk-destructive/5"
                    : "border-wk-mid-grey/40 hover:border-wk-mid-grey",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="importMode"
                  value="fresh"
                  checked={importMode === "fresh"}
                  onChange={() => setImportMode("fresh")}
                  className="mt-0.5 accent-wk-destructive"
                />
                <div>
                  <p className="text-sm font-medium text-wk-graphite">Wipe &amp; reimport</p>
                  <p className="text-xs text-wk-night-grey">
                    Delete all existing kiosks, locations, assignments, and product configs, then import everything fresh.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep("mapping")}
              className="text-sm text-wk-azure hover:underline"
            >
              Edit field mapping
            </button>
            <div className="flex flex-col items-end gap-2">
              {importBlocked && (
                <p className="text-xs text-wk-destructive">
                  Resolve all field conflicts before importing. {unresolved} conflict(s) remaining.
                </p>
              )}
              <Button
                variant={importMode === "fresh" ? "destructive" : "default"}
                className={importMode !== "fresh" ? "bg-[#00A6D3] hover:bg-[#0090b8] text-white" : ""}
                disabled={importBlocked}
                onClick={() => setShowConfirm(true)}
              >
                {importMode === "fresh" ? "Wipe & Reimport" : "Run Import"}
              </Button>
            </div>
          </div>

          {/* Confirmation dialog */}
          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogContent showCloseButton={false} className={importMode === "fresh" ? "border-destructive/30" : ""}>
              <DialogHeader>
                <DialogTitle>
                  {importMode === "fresh"
                    ? `Wipe all data and reimport ${preview.totalItems} records?`
                    : `Import ${preview.totalItems} records?`}
                </DialogTitle>
                <DialogDescription>
                  {importMode === "fresh"
                    ? "This will permanently delete ALL existing kiosks, locations, assignments, products, providers, and product configurations, then import everything from Monday.com. This action cannot be undone."
                    : "This will create new kiosk and location records in the database. Existing records with matching kiosk IDs will be skipped. This action cannot be undone."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button onClick={handleConfirmImport}>
                  Run Import
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* S5: Import in progress */}
      {step === "importing" && progress && (
        <div className="space-y-6">
          {/* Sub-step indicator */}
          <ImportSubStepIndicator step={importStep} />

          <div className="space-y-2">
            <p className="text-sm font-medium text-wk-graphite">
              Importing records… ({progress.current} / {progress.total})
            </p>
            <Progress
              value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0}
              className="[&_[data-slot=progress-indicator]]:bg-wk-azure"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-wk-graphite mb-2">Import log</p>
            <ScrollArea className="h-64 rounded-lg border border-wk-mid-grey/40 p-3">
              {progress.log.map((entry, i) => (
                <LogEntry key={i} entry={entry} />
              ))}
              <div ref={logEndRef} />
            </ScrollArea>
          </div>
        </div>
      )}

      {/* S6: Import complete */}
      {step === "complete" && progress && (
        <div className="space-y-6">
          {progress.status === "error" ? (
            <Alert variant="destructive">
              <AlertDescription>
                Import failed. Check the log below for details.
              </AlertDescription>
            </Alert>
          ) : progress.result ? (
            <div className="rounded-lg bg-wk-light-grey px-4 py-4 space-y-1">
              {progress.result.errors === 0 ? (
                <p className="text-sm font-medium text-wk-graphite">
                  Import complete. {progress.result.kiosksCreated} kiosks and{" "}
                  {progress.result.locationsCreated} locations created.
                  {progress.result.productsCreated > 0 &&
                    ` Also imported: ${progress.result.productsCreated} products, ${progress.result.providersCreated} providers, ${progress.result.locationProductsCreated} product configurations.`}
                </p>
              ) : progress.result.kiosksCreated === 0 ? (
                <p className="text-sm font-medium text-wk-graphite">
                  No records imported. Review warnings above — all rows were
                  duplicates or missing required fields.
                </p>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium text-wk-graphite">
                    Import completed with{" "}
                    <Badge variant="destructive">{progress.result.errors} errors</Badge>.{" "}
                    {progress.result.kiosksCreated} records imported successfully.
                    Review the error log below.
                  </p>
                </div>
              )}
            </div>
          ) : null}

          <div>
            <p className="text-sm font-medium text-wk-graphite mb-2">Import log</p>
            <ScrollArea className="h-64 rounded-lg border border-wk-mid-grey/40 p-3">
              {progress.log.map((entry, i) => (
                <LogEntry key={i} entry={entry} />
              ))}
              <div ref={logEndRef} />
            </ScrollArea>
          </div>

          <div className="flex justify-start">
            <button
              onClick={handleReset}
              className="text-sm text-wk-azure hover:underline"
            >
              Run another import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
