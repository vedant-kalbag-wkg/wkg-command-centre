"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ChevronDown, ChevronUp, Calendar, History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth-client";
import {
  listLocationProducts,
  listAllProviders,
  updateLocationProduct,
  addProduct,
  recalculateLocationProductCommission,
  type LocationProductItem,
  type ProviderSelectItem,
  type CommissionTier,
  type VersionedTierConfig,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers — extract current tiers from versioned config
// ---------------------------------------------------------------------------

/** Today's date as YYYY-MM-DD string. */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Return the tiers from the latest active (effectiveFrom <= today) entry, or [] if none. */
function currentTiers(configs: VersionedTierConfig[]): CommissionTier[] {
  if (!configs || configs.length === 0) return [];
  const today = todayStr();
  const active = configs.filter((c) => c.effectiveFrom <= today);
  if (active.length === 0) return [];
  const sorted = [...active].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return sorted[0].tiers;
}

/** Return the current active versioned config (effectiveFrom <= today), if any. */
function currentVersionedConfig(configs: VersionedTierConfig[]): VersionedTierConfig | null {
  if (!configs || configs.length === 0) return null;
  const today = todayStr();
  const active = configs.filter((c) => c.effectiveFrom <= today);
  if (active.length === 0) return null;
  return [...active].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

/** Return scheduled (future) versioned configs, sorted ascending. */
function scheduledConfigs(configs: VersionedTierConfig[]): VersionedTierConfig[] {
  if (!configs || configs.length === 0) return [];
  const today = todayStr();
  return configs.filter((c) => c.effectiveFrom > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** Return past versioned configs (not the current one), sorted descending. */
function pastConfigs(configs: VersionedTierConfig[]): VersionedTierConfig[] {
  if (!configs || configs.length === 0) return [];
  const today = todayStr();
  const active = configs.filter((c) => c.effectiveFrom <= today);
  if (active.length <= 1) return [];
  const sorted = [...active].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  // Skip the first one (current) and return the rest
  return sorted.slice(1);
}

// ---------------------------------------------------------------------------
// Availability badge
// ---------------------------------------------------------------------------

function AvailabilityDot({ availability }: { availability: string }) {
  const colorMap: Record<string, string> = {
    yes: "bg-green-500",
    no: "bg-border",
    unavailable: "bg-red-400",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colorMap[availability] ?? "bg-border"}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Commission tier chips display
// ---------------------------------------------------------------------------

function TierChips({ tiers }: { tiers: CommissionTier[] }) {
  if (!tiers || tiers.length === 0) {
    return <span className="text-muted-foreground text-[12px]">No tiers</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tiers.map((tier, i) => {
        const displayRate = tier.rate * 100;
        return (
          <span
            key={i}
            className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          >
            {tier.maxRevenue !== null
              ? `<${tier.maxRevenue.toLocaleString()}: ${displayRate}%`
              : `>${tier.minRevenue.toLocaleString()}: ${displayRate}%`}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commission tier editor (inline)
// ---------------------------------------------------------------------------

interface TierEditorProps {
  tiers: CommissionTier[];
  onSave: (tiers: CommissionTier[], effectiveFrom: string) => void;
  onCancel: () => void;
}

function TierEditor({ tiers, onSave, onCancel }: TierEditorProps) {
  // Display rates as whole percentages (e.g. 5 for 5%); engine stores as decimals (0.05)
  const [editedTiers, setEditedTiers] = useState<CommissionTier[]>(
    tiers.length > 0
      ? tiers.map((t) => ({ ...t, rate: t.rate * 100 }))
      : [{ minRevenue: 0, maxRevenue: null, rate: 0 }]
  );
  const [effectiveFrom, setEffectiveFrom] = useState(todayStr());

  const updateTier = (index: number, field: keyof CommissionTier, value: string) => {
    setEditedTiers((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t;
        if (field === "maxRevenue") {
          return { ...t, maxRevenue: value === "" ? null : Number(value) };
        }
        return { ...t, [field]: Number(value) };
      })
    );
  };

  const addTier = () => {
    const last = editedTiers[editedTiers.length - 1];
    const newMin = last ? (last.maxRevenue ?? last.minRevenue + 1000) : 0;
    setEditedTiers((prev) => [
      ...prev,
      { minRevenue: newMin, maxRevenue: null, rate: 0 },
    ]);
  };

  const removeTier = (index: number) => {
    setEditedTiers((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2 pb-1">
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Effective from
        </label>
        <Input
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          className="h-7 w-40 text-sm"
        />
        {effectiveFrom > todayStr() && (
          <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            Scheduled
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Min Revenue</span>
        <span>Max Revenue</span>
        <span>Rate (%)</span>
        <span />
      </div>
      {editedTiers.map((tier, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-center">
          <Input
            type="number"
            value={tier.minRevenue}
            onChange={(e) => updateTier(i, "minRevenue", e.target.value)}
            className="h-7 text-sm"
            placeholder="0"
          />
          <Input
            type="number"
            value={tier.maxRevenue ?? ""}
            onChange={(e) => updateTier(i, "maxRevenue", e.target.value)}
            className="h-7 text-sm"
            placeholder="No cap"
          />
          <Input
            type="number"
            value={tier.rate}
            onChange={(e) => updateTier(i, "rate", e.target.value)}
            className="h-7 text-sm"
            placeholder="0"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => removeTier(i)}
          >
            ×
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[12px]"
          onClick={addTier}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add tier
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 bg-primary text-primary-foreground text-[12px] hover:bg-primary/90"
            onClick={() =>
              onSave(
                editedTiers.map((t) => ({ ...t, rate: t.rate / 100 })),
                effectiveFrom,
              )
            }
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product row
// ---------------------------------------------------------------------------

interface ProductRowProps {
  item: LocationProductItem;
  allProviders: ProviderSelectItem[];
  isAdmin?: boolean;
  onUpdate: (id: string, data: Partial<{ availability: string; providerId: string | null; commissionTiers: VersionedTierConfig[] }>) => Promise<void>;
}

function ProductRow({ item, allProviders, isAdmin, onUpdate }: ProductRowProps) {
  const [showTierEditor, setShowTierEditor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showRecalc, setShowRecalc] = useState(false);
  const [recalcMonth, setRecalcMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [recalcResult, setRecalcResult] = useState<{ reversed: number; recalculated: number } | null>(null);
  const [isUpdating, startUpdateTransition] = useTransition();
  const [isRecalculating, startRecalcTransition] = useTransition();

  const handleAvailabilityChange = (value: string) => {
    startUpdateTransition(async () => {
      await onUpdate(item.id, { availability: value });
    });
  };

  const handleProviderChange = (value: string) => {
    startUpdateTransition(async () => {
      await onUpdate(item.id, { providerId: value === "" ? null : value });
    });
  };

  const handleSaveTiers = async (tiers: CommissionTier[], effectiveFrom: string) => {
    // Preserve existing version history and append a new version
    const newVersion: VersionedTierConfig = { effectiveFrom, tiers };
    // Keep prior versions, replace any with the same effectiveFrom date
    const prior = (item.commissionTiers ?? []).filter(
      (v) => v.effectiveFrom !== newVersion.effectiveFrom,
    );
    await onUpdate(item.id, { commissionTiers: [...prior, newVersion] });
    setShowTierEditor(false);
  };

  const handleRecalculate = () => {
    startRecalcTransition(async () => {
      setRecalcResult(null);
      const result = await recalculateLocationProductCommission(item.id, recalcMonth);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setRecalcResult(result);
        toast.success(`Recalculated: ${result.recalculated} records`);
      }
    });
  };

  return (
    <tr className="border-b border-border hover:bg-muted/30">
      <td className="py-3 pr-4 text-sm font-medium text-foreground">
        {item.productName}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <AvailabilityDot availability={item.availability} />
          <select
            value={item.availability}
            onChange={(e) => handleAvailabilityChange(e.target.value)}
            disabled={isUpdating}
            className="h-7 rounded border border-border px-2 text-sm text-foreground focus:ring-1 focus:ring-ring disabled:opacity-50"
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </div>
      </td>
      <td className="py-3 pr-4">
        <select
          value={item.providerId ?? ""}
          onChange={(e) => handleProviderChange(e.target.value)}
          disabled={isUpdating}
          className="h-7 rounded border border-border px-2 text-sm text-foreground focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          <option value="">None</option>
          {allProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </td>
      <td className="py-3 pr-4">
        <div className="space-y-2">
          {/* Active / Scheduled badges */}
          {(() => {
            const active = currentVersionedConfig(item.commissionTiers);
            const scheduled = scheduledConfigs(item.commissionTiers);
            return (
              <div className="flex flex-wrap gap-1">
                {active && (
                  <span className="inline-flex items-center rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
                    Active since: {active.effectiveFrom}
                  </span>
                )}
                {scheduled.map((s) => (
                  <span
                    key={s.effectiveFrom}
                    className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                  >
                    Scheduled: {s.effectiveFrom}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* Tier editor or display */}
          {showTierEditor ? (
            <TierEditor
              tiers={currentTiers(item.commissionTiers)}
              onSave={handleSaveTiers}
              onCancel={() => setShowTierEditor(false)}
            />
          ) : (
            <button
              onClick={() => setShowTierEditor(true)}
              className="flex items-center gap-1 text-left hover:opacity-70"
            >
              <TierChips tiers={currentTiers(item.commissionTiers)} />
              <span className="ml-1 text-[11px] text-primary">
                <ChevronDown className="h-3 w-3" />
              </span>
            </button>
          )}

          {/* Tier history accordion */}
          {pastConfigs(item.commissionTiers).length > 0 && (
            <div>
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <History className="h-3 w-3" />
                <span>Tier History ({pastConfigs(item.commissionTiers).length})</span>
                {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showHistory && (
                <div className="mt-1 space-y-1.5 border-l-2 border-border pl-2">
                  {pastConfigs(item.commissionTiers).map((cfg) => (
                    <div key={cfg.effectiveFrom} className="space-y-0.5">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {cfg.effectiveFrom}
                      </span>
                      <TierChips tiers={cfg.tiers} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recalculate button (admin-only) */}
          {isAdmin && (
            <div>
              {showRecalc ? (
                <div className="flex items-center gap-2 rounded-md border border-border p-2">
                  <Input
                    type="month"
                    value={recalcMonth}
                    onChange={(e) => {
                      setRecalcMonth(e.target.value);
                      setRecalcResult(null);
                    }}
                    className="h-7 w-36 text-sm"
                  />
                  <Button
                    size="sm"
                    className="h-7 bg-primary text-primary-foreground text-[12px] hover:bg-primary/90"
                    onClick={handleRecalculate}
                    disabled={isRecalculating}
                  >
                    {isRecalculating ? "Running..." : "Run"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[12px]"
                    onClick={() => { setShowRecalc(false); setRecalcResult(null); }}
                  >
                    Cancel
                  </Button>
                  {recalcResult && (
                    <span className="text-[11px] text-green-700">
                      {recalcResult.reversed} reversed, {recalcResult.recalculated} recalculated
                    </span>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowRecalc(true)}
                  className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Recalculate</span>
                </button>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface LocationProductsClientProps {
  locationId: string;
}

export function LocationProductsClient({ locationId }: LocationProductsClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [locationProductItems, setLocationProductItems] = useState<LocationProductItem[]>([]);
  const [allProviders, setAllProviders] = useState<ProviderSelectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newProductName, setNewProductName] = useState("");
  const [isAdding, startAddTransition] = useTransition();

  // Fetch data on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [items, provs] = await Promise.all([
        listLocationProducts(locationId),
        listAllProviders(),
      ]);
      if (!cancelled) {
        setLocationProductItems(items);
        setAllProviders(provs);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [locationId]);

  const handleUpdate = async (
    id: string,
    data: Partial<{ availability: string; providerId: string | null; commissionTiers: VersionedTierConfig[] }>
  ) => {
    const result = await updateLocationProduct(id, data);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success("Saved");
      // Optimistically update local state
      setLocationProductItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, ...data } : item
        )
      );
    }
  };

  const handleAddProduct = () => {
    if (!newProductName.trim()) return;
    startAddTransition(async () => {
      const result = await addProduct(newProductName.trim());
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Product "${newProductName.trim()}" added to all locations`);
        setNewProductName("");
        // Refresh to show the new product
        const updated = await listLocationProducts(locationId);
        setLocationProductItems(updated);
        router.refresh();
      }
    });
  };

  if (loading) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">Loading products…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {locationProductItems.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No products configured for this location.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Add a product below to configure availability and commission tiers.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Product
                </th>
                <th className="px-0 py-3 pr-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Availability
                </th>
                <th className="py-3 pr-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Provider
                </th>
                <th className="py-3 pr-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Commission Tiers
                </th>
              </tr>
            </thead>
            <tbody>
              {locationProductItems.map((item) => (
                <ProductRow
                  key={item.id}
                  item={item}
                  allProviders={allProviders}
                  isAdmin={isAdmin}
                  onUpdate={handleUpdate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add product section */}
      <div className="flex items-center gap-2 rounded-md border border-border p-3">
        <Input
          placeholder="New product name…"
          value={newProductName}
          onChange={(e) => setNewProductName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddProduct();
          }}
          className="h-8 text-sm"
          disabled={isAdding}
        />
        <Button
          size="sm"
          onClick={handleAddProduct}
          disabled={isAdding || !newProductName.trim()}
          className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {isAdding ? "Adding…" : "Add Product"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Adding a product makes it available across all locations with "Unavailable" status by default.
      </p>
    </div>
  );
}
