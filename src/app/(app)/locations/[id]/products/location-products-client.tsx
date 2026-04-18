"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ChevronDown, ChevronUp, Calendar, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listLocationProducts,
  listAllProviders,
  updateLocationProduct,
  addProduct,
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
    no: "bg-wk-mid-grey",
    unavailable: "bg-red-400",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colorMap[availability] ?? "bg-wk-mid-grey"}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Commission tier chips display
// ---------------------------------------------------------------------------

function TierChips({ tiers }: { tiers: CommissionTier[] }) {
  if (!tiers || tiers.length === 0) {
    return <span className="text-wk-mid-grey text-[12px]">No tiers</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tiers.map((tier, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded bg-wk-light-grey px-1.5 py-0.5 text-[11px] text-wk-night-grey"
        >
          {tier.maxRevenue !== null
            ? `<${tier.maxRevenue.toLocaleString()}: ${tier.rate}%`
            : `>${tier.minRevenue.toLocaleString()}: ${tier.rate}%`}
        </span>
      ))}
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
  const [editedTiers, setEditedTiers] = useState<CommissionTier[]>(
    tiers.length > 0 ? [...tiers] : [{ minRevenue: 0, maxRevenue: null, rate: 0 }]
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
    <div className="space-y-2 rounded-md border border-wk-mid-grey p-3">
      <div className="flex items-center gap-2 pb-1">
        <Calendar className="h-3.5 w-3.5 text-wk-night-grey" />
        <label className="text-[11px] font-medium uppercase tracking-wide text-wk-night-grey">
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
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 text-[11px] font-medium uppercase tracking-wide text-wk-night-grey">
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
            className="h-7 w-7 p-0 text-wk-mid-grey hover:text-destructive"
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
            className="h-7 bg-wk-azure text-white text-[12px] hover:bg-wk-azure/90"
            onClick={() => onSave(editedTiers, effectiveFrom)}
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
  onUpdate: (id: string, data: Partial<{ availability: string; providerId: string | null; commissionTiers: VersionedTierConfig[] }>) => Promise<void>;
}

function ProductRow({ item, allProviders, onUpdate }: ProductRowProps) {
  const [showTierEditor, setShowTierEditor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isUpdating, startUpdateTransition] = useTransition();

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

  return (
    <tr className="border-b border-wk-light-grey hover:bg-wk-light-grey/30">
      <td className="py-3 pr-4 text-sm font-medium text-wk-graphite">
        {item.productName}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <AvailabilityDot availability={item.availability} />
          <select
            value={item.availability}
            onChange={(e) => handleAvailabilityChange(e.target.value)}
            disabled={isUpdating}
            className="h-7 rounded border border-wk-mid-grey px-2 text-sm text-wk-graphite focus:ring-1 focus:ring-wk-azure disabled:opacity-50"
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
          className="h-7 rounded border border-wk-mid-grey px-2 text-sm text-wk-graphite focus:ring-1 focus:ring-wk-azure disabled:opacity-50"
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
              <span className="ml-1 text-[11px] text-wk-azure">
                <ChevronDown className="h-3 w-3" />
              </span>
            </button>
          )}

          {/* Tier history accordion */}
          {pastConfigs(item.commissionTiers).length > 0 && (
            <div>
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-wk-night-grey hover:text-wk-graphite"
              >
                <History className="h-3 w-3" />
                <span>Tier History ({pastConfigs(item.commissionTiers).length})</span>
                {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showHistory && (
                <div className="mt-1 space-y-1.5 border-l-2 border-wk-light-grey pl-2">
                  {pastConfigs(item.commissionTiers).map((cfg) => (
                    <div key={cfg.effectiveFrom} className="space-y-0.5">
                      <span className="text-[10px] font-medium text-wk-night-grey">
                        {cfg.effectiveFrom}
                      </span>
                      <TierChips tiers={cfg.tiers} />
                    </div>
                  ))}
                </div>
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
        <p className="text-sm text-wk-night-grey">Loading products…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {locationProductItems.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-wk-night-grey">No products configured for this location.</p>
          <p className="mt-1 text-[12px] text-wk-mid-grey">
            Add a product below to configure availability and commission tiers.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-wk-mid-grey">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-wk-mid-grey bg-wk-light-grey/50 text-left">
                <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-wk-night-grey">
                  Product
                </th>
                <th className="px-0 py-3 pr-4 text-[11px] font-medium uppercase tracking-wide text-wk-night-grey">
                  Availability
                </th>
                <th className="py-3 pr-4 text-[11px] font-medium uppercase tracking-wide text-wk-night-grey">
                  Provider
                </th>
                <th className="py-3 pr-4 text-[11px] font-medium uppercase tracking-wide text-wk-night-grey">
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
                  onUpdate={handleUpdate}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add product section */}
      <div className="flex items-center gap-2 rounded-md border border-wk-mid-grey p-3">
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
          className="h-8 bg-wk-azure text-white hover:bg-wk-azure/90"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {isAdding ? "Adding…" : "Add Product"}
        </Button>
      </div>
      <p className="text-[11px] text-wk-mid-grey">
        Adding a product makes it available across all locations with "Unavailable" status by default.
      </p>
    </div>
  );
}
