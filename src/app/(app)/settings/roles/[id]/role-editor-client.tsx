"use client";

import * as React from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACTIONS, KNOWN_SUBJECTS } from "@/lib/casl/types";
import { fieldsOfSubject } from "@/lib/casl/fields";
import type { Subject, Action } from "@/lib/casl/types";
import type { RoleDetail } from "../editor-internal";
import type { RawRule } from "@/lib/casl/types";
import { DiffPreviewModal } from "./diff-preview-modal";

// ── Types ─────────────────────────────────────────────────────────────

type ConditionRow = { key: string; op: string; value: string };

type RuleFormRow = {
  subject: string;
  actions: string[];
  fields: string[];
  conditions: ConditionRow[];
  inverted: boolean;
  /** When true, show raw JSON textarea instead of structured condition builder */
  conditionsJsonMode: boolean;
  conditionsJson: string;
};

type FormValues = {
  rules: RuleFormRow[];
};

type Diff = {
  added: RawRule[];
  removed: RawRule[];
  changed: { before: RawRule; after: RawRule }[];
};

// ── Diff computation ──────────────────────────────────────────────────

function ruleKey(r: RawRule): string {
  return JSON.stringify({
    action: Array.isArray(r.action) ? [...(r.action as string[])].sort() : r.action,
    subject: r.subject,
    fields: r.fields ? [...r.fields].sort() : null,
    conditions: r.conditions ?? null,
    inverted: r.inverted ?? false,
  });
}

function computeDiff(original: RawRule[], next: RawRule[]): Diff {
  const origMap = new Map<string, RawRule>();
  const nextMap = new Map<string, RawRule>();
  for (const r of original) origMap.set(ruleKey(r), r);
  for (const r of next) nextMap.set(ruleKey(r), r);

  const added: RawRule[] = [];
  const removed: RawRule[] = [];

  for (const [k, r] of nextMap) {
    if (!origMap.has(k)) added.push(r);
  }
  for (const [k, r] of origMap) {
    if (!nextMap.has(k)) removed.push(r);
  }

  // Pair up "changed" items by matching on subject+inverted (same intent, different permissions)
  // For simplicity: items with the same subject that moved from removed → added are "changed"
  const changed: { before: RawRule; after: RawRule }[] = [];
  const pairedRemovedKeys = new Set<string>();
  const pairedAddedKeys = new Set<string>();

  for (const a of added) {
    for (const r of removed) {
      const rKey = ruleKey(r);
      if (pairedRemovedKeys.has(rKey)) continue;
      const aKey = ruleKey(a);
      if (pairedAddedKeys.has(aKey)) continue;
      // Match heuristic: same subject + same inverted flag
      if (r.subject === a.subject && (r.inverted ?? false) === (a.inverted ?? false)) {
        changed.push({ before: r, after: a });
        pairedRemovedKeys.add(rKey);
        pairedAddedKeys.add(aKey);
        break;
      }
    }
  }

  return {
    added: added.filter((a) => !pairedAddedKeys.has(ruleKey(a))),
    removed: removed.filter((r) => !pairedRemovedKeys.has(ruleKey(r))),
    changed,
  };
}

// ── Form ↔ RawRule converters ──────────────────────────────────────────

/**
 * Converts a form row into one RawRule per action.
 * The DB stores one action per row; a multi-action chip selection expands
 * into multiple rules sharing the same subject/fields/conditions/inverted.
 */
function rowToRawRules(row: RuleFormRow): RawRule[] {
  let conditions: Record<string, unknown> | null = null;
  if (row.conditionsJsonMode) {
    try {
      const parsed = JSON.parse(row.conditionsJson);
      conditions = typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      conditions = null;
    }
  } else if (row.conditions.length > 0) {
    conditions = {};
    for (const c of row.conditions) {
      if (!c.key.trim()) continue;
      const val = c.value;
      const parsed = (() => {
        if (val === "true") return true;
        if (val === "false") return false;
        const n = Number(val);
        if (!isNaN(n) && val.trim() !== "") return n;
        return val;
      })();
      if (c.op === "eq") {
        conditions[c.key] = parsed;
      } else {
        conditions[c.key] = { [`$${c.op}`]: parsed };
      }
    }
    if (Object.keys(conditions).length === 0) conditions = null;
  }

  const actions = row.actions.length > 0 ? row.actions : ["read"];
  return actions.map((action) => ({
    action: action as Action | string,
    subject: row.subject,
    fields: row.fields.length > 0 ? row.fields : null,
    conditions,
    inverted: row.inverted,
  }));
}

function rawRuleToRow(r: RawRule): RuleFormRow {
  const actions = Array.isArray(r.action)
    ? (r.action as string[])
    : [r.action as string];

  // Detect if conditions can be represented as structured rows
  let conditionsJsonMode = false;
  let conditionsJson = "";
  let conditions: ConditionRow[] = [];

  if (r.conditions && Object.keys(r.conditions).length > 0) {
    const rows: ConditionRow[] = [];
    let canStructure = true;
    for (const [key, val] of Object.entries(r.conditions)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        const ops = Object.keys(val as object);
        if (ops.length === 1 && ops[0].startsWith("$")) {
          const op = ops[0].slice(1);
          rows.push({ key, op, value: String((val as Record<string, unknown>)[ops[0]]) });
        } else {
          canStructure = false;
          break;
        }
      } else if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        rows.push({ key, op: "eq", value: String(val) });
      } else {
        canStructure = false;
        break;
      }
    }
    if (canStructure) {
      conditions = rows;
    } else {
      conditionsJsonMode = true;
      conditionsJson = JSON.stringify(r.conditions, null, 2);
    }
  }

  return {
    subject: r.subject as string,
    actions,
    fields: r.fields ?? [],
    conditions,
    inverted: r.inverted ?? false,
    conditionsJsonMode,
    conditionsJson,
  };
}

// ── Constants ─────────────────────────────────────────────────────────

const CONDITION_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in"] as const;
const CONDITION_OP_LABELS: Record<string, string> = {
  eq: "=",
  ne: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "in",
};

// ── Sub-components ────────────────────────────────────────────────────

function ActionChips({
  selected,
  disabled,
  onChange,
}: {
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  function toggle(action: string) {
    if (selected.includes(action)) {
      onChange(selected.filter((a) => a !== action));
    } else {
      onChange([...selected, action]);
    }
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {ACTIONS.map((action) => {
        const active = selected.includes(action);
        return (
          <button
            key={action}
            type="button"
            disabled={disabled}
            onClick={() => toggle(action)}
            className={[
              "px-2 py-0.5 rounded text-xs font-mono border transition-colors",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent border-border text-muted-foreground hover:border-primary/60 hover:text-foreground",
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {action}
          </button>
        );
      })}
    </div>
  );
}

function FieldPicker({
  subject,
  selected,
  disabled,
  onChange,
}: {
  subject: string;
  selected: string[];
  disabled: boolean;
  onChange: (fields: string[]) => void;
}) {
  const availableFields = React.useMemo(() => {
    if (!subject || subject === "all") return [];
    try {
      return fieldsOfSubject(subject as Subject);
    } catch {
      return [];
    }
  }, [subject]);

  if (availableFields.length === 0) return null;

  function toggle(field: string) {
    if (selected.includes(field)) {
      onChange(selected.filter((f) => f !== field));
    } else {
      onChange([...selected, field]);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        Fields{" "}
        <span className="font-normal italic">(empty = all fields)</span>
      </Label>
      <div className="flex flex-wrap gap-1">
        {availableFields.map((f) => {
          const active = selected.includes(f);
          return (
            <button
              key={f}
              type="button"
              disabled={disabled}
              onClick={() => toggle(f)}
              className={[
                "px-1.5 py-0.5 rounded text-xs font-mono border transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground border-secondary"
                  : "bg-transparent border-border text-muted-foreground hover:border-secondary/60",
                disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {f}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConditionsBuilder({
  rows,
  jsonMode,
  jsonText,
  disabled,
  onRowsChange,
  onJsonModeToggle,
  onJsonTextChange,
}: {
  rows: ConditionRow[];
  jsonMode: boolean;
  jsonText: string;
  disabled: boolean;
  onRowsChange: (rows: ConditionRow[]) => void;
  onJsonModeToggle: () => void;
  onJsonTextChange: (text: string) => void;
}) {
  function addRow() {
    onRowsChange([...rows, { key: "", op: "eq", value: "" }]);
  }
  function removeRow(i: number) {
    onRowsChange(rows.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, patch: Partial<ConditionRow>) {
    onRowsChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Conditions</Label>
        <button
          type="button"
          disabled={disabled}
          onClick={onJsonModeToggle}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {jsonMode ? "Switch to form" : "Switch to JSON"}
        </button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Conditions are stored on the rule but are not yet enforced against
        resource instances. Per-user access scoping (region, hotel group,
        location, etc.) is driven by the user&apos;s scope assignments on the
        user page, not by these conditions.
      </p>

      {jsonMode ? (
        <textarea
          disabled={disabled}
          value={jsonText}
          onChange={(e) => onJsonTextChange(e.target.value)}
          placeholder="{}"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono min-h-[80px] resize-y disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                disabled={disabled}
                placeholder="field"
                value={row.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                className="h-7 text-xs font-mono flex-1 min-w-0"
              />
              <select
                disabled={disabled}
                value={row.op}
                onChange={(e) => updateRow(i, { op: e.target.value })}
                className="h-7 rounded-md border border-input bg-background px-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {CONDITION_OPS.map((op) => (
                  <option key={op} value={op}>
                    {CONDITION_OP_LABELS[op]}
                  </option>
                ))}
              </select>
              <Input
                disabled={disabled}
                placeholder="value"
                value={row.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                className="h-7 text-xs flex-1 min-w-0"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeRow(i)}
                className="p-1 rounded text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={addRow}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="size-3" />
            Add condition
          </button>
        </div>
      )}
    </div>
  );
}

// ── Rule row ──────────────────────────────────────────────────────────

function RuleRow({
  index,
  control,
  register,
  setValue,
  getValues,
  disabled,
  onRemove,
}: {
  index: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getValues: any;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = React.useState(true);

  const subject = useWatch({ control, name: `rules.${index}.subject` });
  const actions = useWatch({ control, name: `rules.${index}.actions` });
  const fields = useWatch({ control, name: `rules.${index}.fields` });
  const inverted = useWatch({ control, name: `rules.${index}.inverted` });
  const conditions = useWatch({ control, name: `rules.${index}.conditions` });
  const conditionsJsonMode = useWatch({ control, name: `rules.${index}.conditionsJsonMode` });
  const conditionsJson = useWatch({ control, name: `rules.${index}.conditionsJson` });

  // Plan 10-14 / Cluster B Task 2 — subject-first join so /kiosk.*read/i matches.
  // Spec: edit-tier.spec.ts:58 page.getByRole('row', { name: /kiosk.*read/i }).
  // The regex demands "kiosk" before "read"; subject-first produces "Kiosk read"
  // which matches, action-first would produce "read Kiosk" which would NOT.
  const accessibleName = [
    (subject as string) ?? "",
    ((actions as string[]) ?? []).filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .trim() || `rule-${index + 1}`;

  return (
    <div
      role="row"
      aria-label={accessibleName}
      className="rounded-lg border border-border bg-card"
    >
      {/* Row header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>

        <span className="text-xs text-muted-foreground font-mono shrink-0">
          #{index + 1}
        </span>

        {/* Compact summary when collapsed */}
        {!expanded && (
          <span className="text-xs font-mono text-foreground/80 truncate flex-1">
            {inverted ? (
              <Badge variant="outline" className="text-destructive border-destructive/50 mr-1.5">
                DENY
              </Badge>
            ) : (
              <Badge variant="outline" className="text-green-700 border-green-500/50 mr-1.5">
                ALLOW
              </Badge>
            )}
            {(actions as string[]).join(", ") || "—"} {subject || "—"}
          </span>
        )}

        {expanded && <span className="flex-1" />}

        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
          title="Remove rule"
          aria-label="Remove"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/50 pt-3">
          {/* Subject */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Subject</Label>
            <Select
              disabled={disabled}
              value={subject as string}
              onValueChange={(v) => setValue(`rules.${index}.subject`, v, { shouldDirty: true })}
            >
              <SelectTrigger className="h-8 text-xs font-mono">
                <SelectValue placeholder="Select subject…" />
              </SelectTrigger>
              <SelectContent>
                {KNOWN_SUBJECTS.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs font-mono">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Actions</Label>
            <ActionChips
              selected={actions as string[]}
              disabled={disabled}
              onChange={(next) =>
                setValue(`rules.${index}.actions`, next, { shouldDirty: true })
              }
            />
            {(actions as string[]).length === 0 && (
              <p className="text-xs text-destructive">Select at least one action.</p>
            )}
          </div>

          {/* Allow / Deny toggle */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Effect</Label>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                setValue(`rules.${index}.inverted`, !inverted, { shouldDirty: true })
              }
              className={[
                "px-2.5 py-0.5 rounded border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                inverted
                  ? "bg-destructive/10 border-destructive/50 text-destructive"
                  : "bg-green-50 border-green-500/50 text-green-700 dark:bg-green-950/30 dark:text-green-400",
              ].join(" ")}
            >
              {inverted ? "DENY" : "ALLOW"}
            </button>
            <span className="text-xs text-muted-foreground">
              Click to toggle
            </span>
          </div>

          {/* Field picker */}
          <FieldPicker
            subject={subject as string}
            selected={fields as string[]}
            disabled={disabled}
            onChange={(next) =>
              setValue(`rules.${index}.fields`, next, { shouldDirty: true })
            }
          />

          {/* Conditions */}
          <ConditionsBuilder
            rows={conditions as ConditionRow[]}
            jsonMode={conditionsJsonMode as boolean}
            jsonText={conditionsJson as string}
            disabled={disabled}
            onRowsChange={(next) =>
              setValue(`rules.${index}.conditions`, next, { shouldDirty: true })
            }
            onJsonModeToggle={() => {
              const current = getValues(`rules.${index}`);
              if (!conditionsJsonMode) {
                // switching to JSON: serialize structured rows
                const obj: Record<string, unknown> = {};
                for (const c of current.conditions as ConditionRow[]) {
                  if (!c.key.trim()) continue;
                  if (c.op === "eq") obj[c.key] = c.value;
                  else obj[c.key] = { [`$${c.op}`]: c.value };
                }
                setValue(`rules.${index}.conditionsJson`, JSON.stringify(obj, null, 2), { shouldDirty: true });
              } else {
                // switching from JSON: parse and populate rows
                try {
                  const parsed = JSON.parse(current.conditionsJson as string);
                  const rows: ConditionRow[] = [];
                  for (const [key, val] of Object.entries(parsed)) {
                    if (typeof val === "object" && val !== null) {
                      const ops = Object.keys(val as object);
                      if (ops.length === 1 && ops[0].startsWith("$")) {
                        rows.push({ key, op: ops[0].slice(1), value: String((val as Record<string, unknown>)[ops[0]]) });
                        continue;
                      }
                    }
                    rows.push({ key, op: "eq", value: String(val) });
                  }
                  setValue(`rules.${index}.conditions`, rows, { shouldDirty: true });
                } catch {
                  // Invalid JSON — keep current rows, just toggle mode
                }
              }
              setValue(`rules.${index}.conditionsJsonMode`, !conditionsJsonMode, { shouldDirty: true });
            }}
            onJsonTextChange={(text) =>
              setValue(`rules.${index}.conditionsJson`, text, { shouldDirty: true })
            }
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

export function RoleEditorClient({ role }: { role: RoleDetail }) {
  const isSystem = role.kind === "system";

  const { control, handleSubmit, setValue, getValues, reset, formState } =
    useForm<FormValues>({
      defaultValues: {
        rules: role.rules.map(rawRuleToRow),
      },
    });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "rules",
  });

  const [diffOpen, setDiffOpen] = React.useState(false);
  const [pendingDiff, setPendingDiff] = React.useState<{
    diff: {
      added: RawRule[];
      removed: RawRule[];
      changed: { before: RawRule; after: RawRule }[];
    };
    newRules: RawRule[];
  } | null>(null);

  // Plan 10-15 / Cluster 2 — Sonner v2 toasts have aria-live but no role="status",
  // so page.getByRole("status") never matches a toast. Mirror the toast text into
  // a parent-scope live region (held here, not inside DiffPreviewModal whose state
  // is wiped when setPendingDiff(null) unmounts it) so screen readers + the
  // tests/access-control/edit-tier.spec.ts:73-75 assertion both resolve.
  const [savedMessage, setSavedMessage] = React.useState<string | null>(null);

  function onPreviewSave(data: FormValues) {
    const newRules = data.rules.flatMap(rowToRawRules);
    const diff = computeDiff(role.rules, newRules);
    setPendingDiff({ diff, newRules });
    setDiffOpen(true);
  }

  function handleCancel() {
    reset({ rules: role.rules.map(rawRuleToRow) });
  }

  function addRule() {
    append({
      subject: "all",
      actions: ["read"],
      fields: [],
      conditions: [],
      inverted: false,
      conditionsJsonMode: false,
      conditionsJson: "",
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* System role banner */}
      {isSystem && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          System roles are immutable. Their rule set is enforced by the ability
          builder&apos;s short-circuit and not editable here.
        </div>
      )}

      {/* Rules list */}
      <form onSubmit={handleSubmit(onPreviewSave)}>
        <div className="space-y-3">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No rules defined. Add a rule below.
            </p>
          ) : (
            fields.map((field, index) => (
              <RuleRow
                key={field.id}
                index={index}
                control={control}
                register={() => {}}
                setValue={setValue}
                getValues={getValues}
                disabled={isSystem}
                onRemove={() => remove(index)}
              />
            ))
          )}
        </div>

        {/* Add rule button */}
        {!isSystem && (
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRule}
              className="h-8 text-xs"
            >
              <Plus className="size-3.5" />
              Add rule
            </Button>
          </div>
        )}

        {/* Footer actions */}
        {!isSystem && (
          <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={!formState.isDirty}
            >
              Cancel
            </Button>
            <Button type="submit">Preview &amp; Save</Button>
          </div>
        )}
      </form>

      {/* Diff preview modal */}
      {pendingDiff && (
        <DiffPreviewModal
          open={diffOpen}
          onOpenChange={setDiffOpen}
          roleId={role.id}
          diff={pendingDiff.diff}
          newRules={pendingDiff.newRules}
          assignedUserCount={role.assignedUserCount}
          onSuccess={(msg) => {
            reset({ rules: pendingDiff.newRules.map(rawRuleToRow) });
            setPendingDiff(null);
            if (msg) setSavedMessage(msg);
          }}
        />
      )}

      {/* Out-of-band live region — see savedMessage comment above. */}
      {savedMessage && (
        <div role="status" aria-live="polite" className="sr-only">
          {savedMessage}
        </div>
      )}
    </div>
  );
}
