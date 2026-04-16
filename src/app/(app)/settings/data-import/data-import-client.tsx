"use client";

import * as React from "react";
import { CheckIcon, Loader2, Plus, X } from "lucide-react";
import {
  exploreBoardColumns,
  detectSplits,
  runDryImport,
  runFullImport,
  getImportProgress,
  loadBoardIds,
  saveBoardIds,
  loadCustomFields,
  saveCustomFields,
} from "./actions";
import { runAutoFullImport } from "./auto-import-actions";
import type { CustomFieldDef } from "./actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  { value: "kiosk:hardwareSerialNumber", label: "Kiosk — Hardware Serial Number (Assets)", table: "kiosk" },
  { value: "kiosk:hardwareModel", label: "Kiosk — Hardware Model", table: "kiosk" },
  { value: "kiosk:softwareVersion", label: "Kiosk — Software Version", table: "kiosk" },
  { value: "kiosk:freeTrialStatus", label: "Kiosk — Free Trial Status", table: "kiosk" },
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
  { value: "location:region", label: "Location — Region", table: "location" },
  { value: "location:locationGroup", label: "Location — Location Group", table: "location" },
  { value: "location:internalPoc", label: "Location — Internal POC", table: "location" },
  { value: "location:status", label: "Location — Status", table: "location" },
];

// =============================================================================
// Step indicator
// =============================================================================

function StepIndicator({ step, boardLabel }: { step: Step; boardLabel?: string }) {
  const mappingLabel = boardLabel ? `Review Mapping (${boardLabel})` : "Review Mapping";
  const steps: Array<{ id: number; label: string; activeOn: Step[] }> = [
    { id: 1, label: "Connect Board", activeOn: ["connect", "fetching"] },
    { id: 2, label: mappingLabel, activeOn: ["mapping"] },
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

function ImportSubStepIndicator({ step }: { step: 1 | 2 | 3 | 4 }) {
  const labels = ["Kiosks", "Hotels", "Config Groups", "Deduplicate"];
  return (
    <div className="flex items-center gap-2 mb-4">
      {labels.map((label, idx) => {
        const stepNum = (idx + 1) as 1 | 2 | 3 | 4;
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
                Step {stepNum} of 4 — {label}
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

  // Three board ID inputs — default to known board IDs, fallback to env/prop
  const [boardIds, setBoardIds] = React.useState({
    kiosks: defaultBoardId || "1426737864",
    hotels: "",
    configGroups: "1466686598",
  });

  // Track the last successfully saved values for "Saved" badge
  const savedBoardIdsRef = React.useRef({ kiosks: "", hotels: "", configGroups: "" });

  // Which board is actively being mapped/imported
  const [activeBoard, setActiveBoard] = React.useState<ActiveBoard>("kiosks");

  // Per-board import state — each board gets its own mapping, preview, etc.
  type BoardImportState = {
    mappings: FieldMapping[];
    splitDecisions: SplitDecision[];
    fetchId: string | null;
    preview: ImportPreview | null;
    conflictResolutions: Map<string, Map<string, string>>;
    confirmed: boolean;
  };

  const emptyBoardState = (): BoardImportState => ({
    mappings: [], splitDecisions: [], fetchId: null, preview: null,
    conflictResolutions: new Map(), confirmed: false,
  });

  // Persisted custom fields — shared across all boards, saved to appSettings
  const [customFields, setCustomFields] = React.useState<CustomFieldDef[]>([]);

  const [boardStates, setBoardStates] = React.useState<Record<ActiveBoard, BoardImportState>>({
    kiosks: emptyBoardState(),
    hotels: emptyBoardState(),
    configGroups: emptyBoardState(),
  });

  function updateBoardState(board: ActiveBoard, patch: Partial<BoardImportState>) {
    setBoardStates((prev) => ({ ...prev, [board]: { ...prev[board], ...patch } }));
  }

  // Convenience accessors for the active board's state
  const bs = boardStates[activeBoard];

  // Sequential import mode: "Run Import" walks through all boards
  const [isSequentialRun, setIsSequentialRun] = React.useState(false);

  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<ImportProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [showAutoConfirm, setShowAutoConfirm] = React.useState(false);
  const [importMode, setImportMode] = React.useState<"fresh" | "incremental">("incremental");
  const [importStep, setImportStep] = React.useState<1 | 2 | 3 | 4>(1);

  // New field dialog state
  const [showNewFieldDialog, setShowNewFieldDialog] = React.useState(false);
  const [newFieldTable, setNewFieldTable] = React.useState<"kiosk" | "location">("kiosk");
  const [newFieldName, setNewFieldName] = React.useState("");
  const pendingColumnIdRef = React.useRef<string | null>(null);

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

  // On mount: load saved board IDs + custom fields
  React.useEffect(() => {
    let cancelled = false;
    loadBoardIds().then((saved) => {
      if (cancelled) return;
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
    loadCustomFields().then((fields) => {
      if (cancelled) return;
      if (fields.length > 0) setCustomFields(fields);
    });
    return () => { cancelled = true; };
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
    let cancelled = false;

    const intervalId = setInterval(async () => {
      const result = await getImportProgress(sessionId);
      if (cancelled) return;
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

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [step, sessionId]);

  // =============================================================================
  // Conflict resolution helpers
  // =============================================================================

  function getConflictResolution(locationName: string, field: string): string | undefined {
    return bs.conflictResolutions.get(locationName)?.get(field);
  }

  function resolveConflict(locationName: string, field: string, value: string) {
    updateBoardState(activeBoard, {
      conflictResolutions: (() => {
        const next = new Map(bs.conflictResolutions);
        const locationMap = new Map(next.get(locationName) ?? []);
        locationMap.set(field, value);
        next.set(locationName, locationMap);
        return next;
      })(),
    });
  }

  function unresolvedConflictsCount(): number {
    if (!bs.preview?.conflicts?.length) return 0;
    let count = 0;
    for (const conflict of bs.preview.conflicts) {
      if (!getConflictResolution(conflict.locationName, conflict.field)) {
        count++;
      }
    }
    return count;
  }

  function buildConflictResolutionsRecord(resolutions: Map<string, Map<string, string>>): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const [locationName, fieldMap] of resolutions.entries()) {
      result[locationName] = Object.fromEntries(fieldMap.entries());
    }
    return result;
  }

  // =============================================================================
  // Handlers
  // =============================================================================

  async function handleConnectBoard(board: ActiveBoard = "kiosks") {
    const rawBoardId = board === "kiosks"
      ? boardIds.kiosks
      : board === "hotels"
      ? boardIds.hotels
      : boardIds.configGroups;

    if (!rawBoardId.trim()) {
      setError("Enter a board ID to continue. Find it in your Monday.com board URL.");
      return;
    }

    // For comma-separated board IDs (hotels), explore the first one for column structure
    const boardId = rawBoardId.split(",")[0].trim();

    setActiveBoard(board);
    setError(null);
    setStep("fetching");

    try {
      const result = await exploreBoardColumns(boardId);
      if ("error" in result) {
        setError(result.error);
        setStep("connect");
        return;
      }

      updateBoardState(board, { mappings: result.mappings, confirmed: false });
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to board");
      setStep("connect");
    }
  }

  // Build the full options list: built-in + persisted custom fields
  const allFieldOptions = React.useMemo(() => {
    const builtIn = [...TARGET_FIELD_OPTIONS];
    const customs = customFields;
    const lastKioskIdx = builtIn.findLastIndex((o) => o.value.startsWith("kiosk:"));
    const kioskCustoms = customs
      .filter((f) => f.table === "kiosk")
      .map((f) => ({ ...f, table: f.table as "kiosk" | "location" | null }));
    const lastLocIdx = builtIn.findLastIndex((o) => o.value.startsWith("location:"));
    const locCustoms = customs
      .filter((f) => f.table === "location")
      .map((f) => ({ ...f, table: f.table as "kiosk" | "location" | null }));

    const result = [...builtIn];
    if (locCustoms.length > 0) {
      result.splice(lastLocIdx + 1, 0, ...locCustoms);
    }
    const updatedLastKioskIdx = result.findLastIndex((o) => o.value.startsWith("kiosk:"));
    if (kioskCustoms.length > 0) {
      result.splice(updatedLastKioskIdx + 1, 0, ...kioskCustoms);
    }
    return result;
  }, [customFields]);

  function handleMappingChange(columnId: string, newValue: string | null) {
    if (!newValue) return;

    if (newValue === "__new_kiosk" || newValue === "__new_location") {
      pendingColumnIdRef.current = columnId;
      setNewFieldTable(newValue === "__new_kiosk" ? "kiosk" : "location");
      setNewFieldName("");
      setShowNewFieldDialog(true);
      return;
    }

    updateBoardState(activeBoard, {
      mappings: bs.mappings.map((m) => {
        if (m.mondayColumnId !== columnId) return m;
        if (newValue === "skip") {
          return { ...m, targetTable: null, targetField: null, status: "unmapped" };
        }
        const [table, field] = newValue.split(":") as ["kiosk" | "location", string];
        return { ...m, targetTable: table, targetField: field, status: "mapped" };
      }),
    });
  }

  function handleCreateCustomField() {
    const trimmed = newFieldName.trim();
    if (!trimmed) return;

    const fieldKey = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

    const value = `${newFieldTable}:custom:${fieldKey}`;

    const newCustom = {
      value,
      label: `${newFieldTable === "kiosk" ? "Kiosk" : "Location"} — ${trimmed} (custom)`,
      table: newFieldTable as "kiosk" | "location",
    };

    // Add to persisted custom fields (no duplicates) and save
    if (!customFields.some((f) => f.value === value)) {
      const updated = [...customFields, newCustom];
      setCustomFields(updated);
      saveCustomFields(updated);
    }

    // Auto-assign to the pending column
    if (pendingColumnIdRef.current) {
      const colId = pendingColumnIdRef.current;
      updateBoardState(activeBoard, {
        mappings: bs.mappings.map((m) => {
          if (m.mondayColumnId !== colId) return m;
          return { ...m, targetTable: newFieldTable, targetField: `custom:${fieldKey}`, status: "mapped" };
        }),
      });
      pendingColumnIdRef.current = null;
    }

    setShowNewFieldDialog(false);
    setNewFieldName("");
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
    const result = await detectSplits(boardId.trim(), bs.mappings);
    if ("error" in result) {
      setError(result.error);
      setStep("mapping");
      return;
    }

    updateBoardState(activeBoard, { fetchId: result.fetchId });

    if (result.splits.length > 0) {
      updateBoardState(activeBoard, { splitDecisions: result.splits });
      setStep("splitting");
    } else {
      await handleRunDryImport(result.fetchId);
    }
  }

  async function handleRunDryImport(fId?: string) {
    setError(null);
    setStep("fetching");

    const boardId = getActiveBoardId();
    const result = await runDryImport(
      boardId.trim(),
      bs.mappings,
      bs.splitDecisions.length > 0 ? bs.splitDecisions : undefined,
      fId ?? bs.fetchId ?? undefined
    );
    if ("error" in result) {
      setError(result.error);
      setStep(bs.splitDecisions.length > 0 ? "splitting" : "mapping");
      return;
    }

    updateBoardState(activeBoard, { preview: result.preview, conflictResolutions: new Map() });
    setStep("preview");
  }

  function handleSplitDecisionChange(itemId: string, decision: string) {
    updateBoardState(activeBoard, {
      splitDecisions: bs.splitDecisions.map((sd) =>
        sd.mondayItemId === itemId
          ? { ...sd, decision: decision as "split" | "keep" }
          : sd
      ),
    });
  }

  async function handleConfirmImport() {
    setShowConfirm(false);
    setError(null);
    setImportStep(1);

    const conflictResolutionsRecord = buildConflictResolutionsRecord(bs.conflictResolutions);

    const result = await runFullImport(
      getActiveBoardId().trim(),
      bs.mappings,
      bs.splitDecisions.length > 0 ? bs.splitDecisions : undefined,
      bs.fetchId ?? undefined,
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
      total: bs.preview?.totalItems ?? 0,
      log: [],
    });
    setStep("importing");
  }

  async function handleAutoFullImport() {
    setShowAutoConfirm(false);
    setError(null);
    setStep("importing");
    setImportStep(1);

    const hotelsBoardIds = boardIds.hotels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await runAutoFullImport({
      kiosksBoardId: boardIds.kiosks.trim(),
      hotelsBoardIds,
    });
    if ("error" in result) {
      setError(result.error);
      setStep("connect");
      return;
    }
    setSessionId(result.sessionId);
    setProgress({
      sessionId: result.sessionId,
      status: "running",
      current: 0,
      total: 0,
      log: [],
    });
    await pollUntilCompleteAndReturn(result.sessionId);
    setStep("complete");
  }

  async function handleSequentialImport() {
    setShowConfirm(false);
    setError(null);
    setStep("importing");

    // Accumulate results across all steps
    const combinedLog: Array<{ timestamp: string; level: "info" | "warn" | "error"; message: string }> = [];
    const totals = { kiosksCreated: 0, locationsCreated: 0, assignmentsCreated: 0, productsCreated: 0, providersCreated: 0, locationProductsCreated: 0, skipped: 0, errors: 0 };
    let configGroupsImported = 0;
    let configGroupsAssigned = 0;
    let dedupMerged = 0;

    function addLog(level: "info" | "warn" | "error", message: string) {
      combinedLog.push({ timestamp: new Date().toISOString(), level, message });
      setProgress((prev) => prev ? { ...prev, log: [...combinedLog] } : prev);
    }

    // Step 1: Kiosks
    setImportStep(1);
    if (boardIds.kiosks.trim()) {
      addLog("info", "Step 1: Importing kiosks...");
      const kState = boardStates.kiosks;
      const kConflicts = buildConflictResolutionsRecord(kState.conflictResolutions);
      const r1 = await runFullImport(
        boardIds.kiosks.trim(),
        kState.mappings,
        kState.splitDecisions.length > 0 ? kState.splitDecisions : undefined,
        kState.fetchId ?? undefined,
        importMode,
        Object.keys(kConflicts).length > 0 ? kConflicts : undefined
      );
      if ("error" in r1) {
        setError("Import stopped at step 1. Check your Monday.com API key and board permissions, then try again.");
        setStep("connect");
        return;
      }
      setSessionId(r1.sessionId);
      setProgress({ sessionId: r1.sessionId, status: "running", current: 0, total: 0, log: [...combinedLog] });
      const finalProgress = await pollUntilCompleteAndReturn(r1.sessionId);
      if (finalProgress?.result) {
        const r = finalProgress.result;
        totals.kiosksCreated += r.kiosksCreated;
        totals.locationsCreated += r.locationsCreated;
        totals.assignmentsCreated += r.assignmentsCreated;
        totals.productsCreated += r.productsCreated;
        totals.providersCreated += r.providersCreated;
        totals.locationProductsCreated += r.locationProductsCreated;
        totals.skipped += r.skipped;
        totals.errors += r.errors;
        addLog("info", `Kiosks done: ${r.kiosksCreated} kiosks, ${r.locationsCreated} locations created`);
      }
    }

    // Step 2: Hotels
    setImportStep(2);
    if (boardIds.hotels.trim()) {
      addLog("info", "Step 2: Importing hotels...");
      const hState = boardStates.hotels;
      const hConflicts = buildConflictResolutionsRecord(hState.conflictResolutions);
      const r2 = await runFullImport(
        boardIds.hotels.trim(),
        hState.mappings,
        hState.splitDecisions.length > 0 ? hState.splitDecisions : undefined,
        hState.fetchId ?? undefined,
        "incremental",
        Object.keys(hConflicts).length > 0 ? hConflicts : undefined
      );
      if ("error" in r2) {
        setError("Import stopped at step 2. Check your Monday.com API key and board permissions, then try again.");
        setStep("connect");
        return;
      }
      setSessionId(r2.sessionId);
      setProgress((prev) => prev ? { ...prev, sessionId: r2.sessionId, status: "running" } : prev);
      const finalProgress = await pollUntilCompleteAndReturn(r2.sessionId);
      if (finalProgress?.result) {
        const r = finalProgress.result;
        totals.locationsCreated += r.locationsCreated;
        totals.productsCreated += r.productsCreated;
        totals.providersCreated += r.providersCreated;
        totals.locationProductsCreated += r.locationProductsCreated;
        totals.skipped += r.skipped;
        totals.errors += r.errors;
        addLog("info", `Hotels done: ${r.locationsCreated} locations created`);
      }
    }

    // Step 3: Config Groups
    setImportStep(3);
    if (boardIds.configGroups.trim()) {
      addLog("info", "Step 3: Importing config groups...");
      const { importConfigGroups } = await import("@/app/(app)/kiosk-config-groups/actions");
      const r3 = await importConfigGroups(boardIds.configGroups.trim());
      if ("error" in r3) {
        setError("Import stopped at step 3. Check your Monday.com API key and board permissions, then try again.");
        setStep("connect");
        return;
      }
      configGroupsImported = r3.imported;
      configGroupsAssigned = r3.assigned;
      addLog("info", `Config groups done: ${r3.imported} groups imported, ${r3.assigned} kiosks assigned`);
    }

    // Step 4: Post-import location dedup
    setImportStep(4);
    addLog("info", "Step 4: Deduplicating locations...");
    const { deduplicateLocations } = await import("./actions");
    const dedupResult = await deduplicateLocations();
    if ("error" in dedupResult) {
      addLog("warn", `Dedup warning: ${dedupResult.error}`);
    } else {
      dedupMerged = dedupResult.merged;
      if (dedupResult.merged > 0) {
        addLog("info", `Merged ${dedupResult.merged} duplicate locations`);
      } else {
        addLog("info", "No duplicate locations found");
      }
    }

    // Set final progress with combined results
    addLog("info", "Import complete!");
    setProgress({
      sessionId: "sequential-complete",
      status: "complete",
      current: totals.kiosksCreated + totals.locationsCreated,
      total: totals.kiosksCreated + totals.locationsCreated,
      log: combinedLog,
      result: {
        ...totals,
        assignmentsCreated: totals.assignmentsCreated + configGroupsAssigned,
      },
    });
    setStep("complete");
  }

  /** Like pollUntilComplete but returns the final progress state */
  async function pollUntilCompleteAndReturn(sid: string): Promise<ImportProgress | null> {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const result = await getImportProgress(sid);
        if ("error" in result) {
          clearInterval(interval);
          resolve(null);
          return;
        }
        setProgress((prev) => prev ? { ...prev, ...result, log: [...(prev.log ?? []), ...result.log.filter((l) => !prev.log?.some((pl) => pl.timestamp === l.timestamp && pl.message === l.message))] } : result);
        if (result.status === "complete" || result.status === "error") {
          clearInterval(interval);
          resolve(result);
        }
      }, 1500);
    });
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
    setBoardIds({ kiosks: defaultBoardId || "1426737864", hotels: "", configGroups: "1466686598" });
    setBoardStates({
      kiosks: emptyBoardState(),
      hotels: emptyBoardState(),
      configGroups: emptyBoardState(),
    });
    setSessionId(null);
    setProgress(null);
    setError(null);
    setShowConfirm(false);
    setShowAutoConfirm(false);
    setImportMode("incremental");
    setImportStep(1);
    setActiveBoard("kiosks");
    setIsSequentialRun(false);
  }

  // =============================================================================
  // Render
  // =============================================================================

  const canRunSequential = boardIds.kiosks.trim().length > 0;
  const unresolved = unresolvedConflictsCount();
  const hasConflicts = (bs.preview?.conflicts?.length ?? 0) > 0;
  const importBlocked = hasConflicts && unresolved > 0;

  return (
    <div className="max-w-4xl">
      <StepIndicator step={step} boardLabel={activeBoard === "kiosks" ? "Kiosks" : activeBoard === "hotels" ? "Hotels" : undefined} />

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

          {/* Primary CTA: Auto Full Reimport (recommended — wipes & rebuilds in one pass) */}
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                className="w-fit"
                disabled={!boardIds.kiosks.trim() || !boardIds.hotels.trim()}
                onClick={() => setShowAutoConfirm(true)}
              >
                Auto Full Reimport
              </Button>
              <span className="text-xs text-wk-night-grey">
                Recommended — wipes all data and rebuilds using hard-coded column mapping.
                Supports comma-separated hotel board IDs.
              </span>
            </div>
            <Button
              variant="outline"
              className="w-fit"
              disabled={!canRunSequential}
              onClick={() => { setIsSequentialRun(true); handleConnectBoard("kiosks"); }}
            >
              Run Import (manual mapping)
            </Button>

            {!canRunSequential && (
              <p className="text-xs text-wk-mid-grey">
                Enter a board ID to continue. Find it in your Monday.com board URL.
              </p>
            )}

            {/* Auto Full Reimport confirmation dialog */}
            <Dialog open={showAutoConfirm} onOpenChange={setShowAutoConfirm}>
              <DialogContent showCloseButton={false} className="border-destructive/30">
                <DialogHeader>
                  <DialogTitle>Wipe all data and run auto reimport?</DialogTitle>
                  <DialogDescription>
                    This will permanently delete ALL existing kiosks, locations,
                    assignments, products, providers, and product configurations, then rebuild the
                    entire data graph from Monday.com using the standard column mapping:
                    <br />
                    <br />
                    1. Fetches hotels from all hotels boards ({boardIds.hotels}) — deduped by name
                    <br />
                    2. Fetches kiosks from the assets board ({boardIds.kiosks}) — splits multi-outlet rows
                    <br />
                    3. Links kiosks to hotels via the Hotel board relation
                    <br />
                    4. Backfills kiosk region from assigned location
                    <br />
                    <br />
                    This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <Button variant="destructive" onClick={handleAutoFullImport}>
                    Wipe & Reimport
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Individual import buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={!boardIds.kiosks.trim()}
                onClick={() => { setIsSequentialRun(false); handleConnectBoard("kiosks"); }}
              >
                Import Kiosks
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!boardIds.hotels.trim()}
                onClick={() => { setIsSequentialRun(false); handleConnectBoard("hotels"); }}
              >
                Import Hotels
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!boardIds.configGroups.trim()}
                onClick={async () => {
                  setError(null);
                  setStep("importing");
                  setImportStep(3);
                  const { importConfigGroups } = await import("@/app/(app)/kiosk-config-groups/actions");
                  const result = await importConfigGroups(boardIds.configGroups.trim());
                  if ("error" in result) {
                    setError(result.error);
                    setStep("connect");
                    return;
                  }
                  setProgress({
                    sessionId: "config-groups",
                    status: "complete",
                    current: result.imported,
                    total: result.imported,
                    log: [{ timestamp: new Date().toISOString(), level: "info", message: `Imported ${result.imported} config groups, assigned ${result.assigned} kiosks` }],
                  });
                  setStep("complete");
                }}
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
                {bs.mappings.map((m) => (
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
                        items={allFieldOptions.map((o) => ({ value: o.value, label: o.label }))}
                      >
                        <SelectTrigger className="w-64">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {allFieldOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                          <div className="border-t border-border mt-1 pt-1">
                            <SelectItem value="__new_kiosk">
                              <span className="flex items-center gap-1.5 text-wk-azure">
                                <Plus className="w-3.5 h-3.5" />
                                New Kiosk field...
                              </span>
                            </SelectItem>
                            <SelectItem value="__new_location">
                              <span className="flex items-center gap-1.5 text-wk-azure">
                                <Plus className="w-3.5 h-3.5" />
                                New Location field...
                              </span>
                            </SelectItem>
                          </div>
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
            {bs.splitDecisions.length} row(s) have comma-separated outlet codes.
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
                {bs.splitDecisions.map((sd) => (
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
      {step === "preview" && bs.preview && (
        <div className="space-y-6">
          {/* Summary stats */}
          <div className="rounded-lg bg-wk-light-grey px-4 py-3 text-sm text-wk-night-grey">
            Preview complete —{" "}
            <strong className="text-wk-graphite">{bs.preview!.totalItems}</strong> records found,{" "}
            <strong className="text-wk-graphite">{bs.preview!.mappedCount}</strong> mapped,{" "}
            <strong className="text-wk-graphite">{bs.preview!.warningCount}</strong> warnings,{" "}
            <strong className="text-wk-graphite">{bs.preview!.duplicateCount}</strong> duplicates
          </div>

          {/* New pipeline stages */}
          {bs.preview!.newStageNames.length > 0 && (
            <Alert>
              <AlertDescription>
                New pipeline stages will be created:{" "}
                <strong>{bs.preview!.newStageNames.join(", ")}</strong>
              </AlertDescription>
            </Alert>
          )}

          {/* Merge conflict resolution */}
          {hasConflicts && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-wk-graphite">
                  Merge conflicts ({bs.preview!.conflicts!.length})
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
                {bs.preview!.conflicts!.map((conflict) => (
                  <ConflictResolutionCard
                    key={`${conflict.locationName}-${conflict.field}`}
                    conflict={conflict}
                    resolutions={bs.conflictResolutions.get(conflict.locationName) ?? new Map()}
                    onResolve={(field, value) => resolveConflict(conflict.locationName, field, value)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Products and providers */}
          {bs.preview!.productNames.length > 0 && (
            <div className="rounded-lg border border-wk-mid-grey/40 p-4 space-y-2">
              <p className="text-sm font-medium text-wk-graphite">
                Products found ({bs.preview!.productNames.length})
              </p>
              <p className="text-sm text-wk-night-grey">
                {bs.preview!.productNames.join(", ")}
              </p>
              {bs.preview!.providerNames.length > 0 && (
                <>
                  <p className="text-sm font-medium text-wk-graphite mt-3">
                    Providers found ({bs.preview!.providerNames.length})
                  </p>
                  <p className="text-sm text-wk-night-grey">
                    {bs.preview!.providerNames.join(", ")}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Sample records table */}
          <div>
            <p className="text-sm font-medium text-wk-graphite mb-2">
              Sample records (first {bs.preview!.sampleRecords.length})
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
                  {bs.preview!.sampleRecords.map((rec, idx) => (
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
              {isSequentialRun ? (
                <Button
                  className="bg-[#00A6D3] hover:bg-[#0090b8] text-white"
                  disabled={importBlocked}
                  onClick={() => {
                    updateBoardState(activeBoard, { confirmed: true });
                    // Advance to next board or execute
                    if (activeBoard === "kiosks" && boardIds.hotels.trim()) {
                      handleConnectBoard("hotels");
                    } else {
                      setShowConfirm(true);
                    }
                  }}
                >
                  {activeBoard === "kiosks" && boardIds.hotels.trim()
                    ? "Confirm & Map Hotels Board"
                    : "Confirm & Run Import"}
                </Button>
              ) : (
                <Button
                  variant={importMode === "fresh" ? "destructive" : "default"}
                  className={importMode !== "fresh" ? "bg-[#00A6D3] hover:bg-[#0090b8] text-white" : ""}
                  disabled={importBlocked}
                  onClick={() => setShowConfirm(true)}
                >
                  {importMode === "fresh" ? "Wipe & Reimport" : "Run Import"}
                </Button>
              )}
            </div>
          </div>

          {/* Confirmation dialog */}
          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogContent showCloseButton={false} className={importMode === "fresh" ? "border-destructive/30" : ""}>
              <DialogHeader>
                <DialogTitle>
                  {importMode === "fresh"
                    ? `Wipe all data and reimport ${bs.preview!.totalItems} records?`
                    : `Import ${bs.preview!.totalItems} records?`}
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
                <Button onClick={isSequentialRun ? handleSequentialImport : handleConfirmImport}>
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

      {/* Add / manage custom fields dialog */}
      <Dialog open={showNewFieldDialog} onOpenChange={setShowNewFieldDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom fields</DialogTitle>
            <DialogDescription>
              Create or remove custom mapping targets. Values are stored in the
              {" "}{newFieldTable}&apos;s custom data column.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Existing custom fields */}
            {customFields.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Existing fields</Label>
                <div className="space-y-1">
                  {customFields.map((f) => (
                    <div
                      key={f.value}
                      className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm"
                    >
                      <span>{f.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = customFields.filter((cf) => cf.value !== f.value);
                          setCustomFields(updated);
                          saveCustomFields(updated);
                        }}
                        className="flex items-center justify-center rounded-sm p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remove field"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add new field */}
            <div className="space-y-1.5">
              <Label htmlFor="custom-field-name">New field name</Label>
              <Input
                id="custom-field-name"
                placeholder="e.g. Contract Reference"
                value={newFieldName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewFieldName(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter" && newFieldName.trim()) {
                    handleCreateCustomField();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className={newFieldTable === "kiosk" ? "border-wk-azure text-wk-azure" : ""}
                onClick={() => setNewFieldTable("kiosk")}
              >
                Kiosk
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={newFieldTable === "location" ? "border-wk-azure text-wk-azure" : ""}
                onClick={() => setNewFieldTable("location")}
              >
                Location
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewFieldDialog(false)}>
              Done
            </Button>
            <Button
              onClick={handleCreateCustomField}
              disabled={!newFieldName.trim()}
              className="bg-wk-azure hover:bg-wk-azure/90"
            >
              Add Field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
