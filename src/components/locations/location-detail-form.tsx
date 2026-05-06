"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Archive, Lock } from "lucide-react";
import { format } from "date-fns";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineEditField } from "@/components/ui/inline-edit-field";
import { KeyContactsEditor } from "@/components/locations/key-contacts-editor";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import { ContractDocuments } from "@/components/locations/contract-documents";
import { LocationKiosksTab } from "@/components/locations/location-kiosks-tab";
import { LocationProductsClient } from "@/app/(app)/locations/[id]/products/location-products-client";
import {
  createLocation,
  listRegionOptions,
  listHotelGroupOptions,
  listKioskConfigGroupOptions,
  setLocationHotelGroupMemberships,
  updateLocationField,
  archiveLocation,
  updateBankingDetails,
} from "@/app/(app)/locations/actions";
import type { LocationWithRelations } from "@/app/(app)/locations/actions";
import { listUsersForSelect } from "@/app/(app)/installations/actions";
import { COMMON_IANA_TIMEZONES } from "@/lib/locations/iana-timezones";
import { LOCATION_TYPES, LOCATION_TYPE_LABELS } from "@/lib/analytics/types";
import { MultiSelectFilter } from "@/components/analytics/multi-select-filter";

// Phase 7.4 — known status values seen on prod (Live / Ready for Launch /
// Removed). Free-text upstream so future Monday rollouts may add others;
// the picker splices in any unknown current value the same way the timezone
// picker does (PR-14 pattern).
const KNOWN_LOCATION_STATUSES = ["Live", "Ready for Launch", "Removed"] as const;
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Section header component
// ---------------------------------------------------------------------------

function SectionHeader({ title, open }: { title: string; open: boolean }) {
  return (
    <div className="flex items-center justify-between py-3">
      <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {open ? (
        <ChevronUp className="h-4 w-4 text-muted-foreground" />
      ) : (
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field row component — label + content
// ---------------------------------------------------------------------------

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] items-start gap-4 py-2">
      <Label className="pt-1 text-[12px] font-normal text-muted-foreground">{label}</Label>
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section component
// ---------------------------------------------------------------------------

function DetailSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full border-b border-border text-left">
        <SectionHeader title={title} open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="py-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Restricted field badge
// ---------------------------------------------------------------------------

function RestrictedBadge() {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-[12px] text-muted-foreground">
        Restricted — contact your admin for access.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Location create form
// ---------------------------------------------------------------------------

function NewLocationForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fields, setFields] = useState({
    name: "",
    customerCode: "",
    primaryRegionId: "",
    address: "",
    latitude: "",
    longitude: "",
    starRating: "",
    roomCount: "",
    hotelGroup: "",
    sourcedBy: "",
    notes: "",
    contractValue: "",
    contractStartDate: "",
    contractEndDate: "",
    contractTerms: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [regionOptions, setRegionOptions] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    // Regions are required on locations since migration 0022. Loaded client-
    // side so the picker stays in sync when admins create/rename regions
    // without reloading the page.
    listRegionOptions().then(setRegionOptions).catch(() => setRegionOptions([]));
  }, []);

  const handleCreate = () => {
    startTransition(async () => {
      setError(null);
      const result = await createLocation({
        name: fields.name,
        customerCode: fields.customerCode || undefined,
        primaryRegionId: fields.primaryRegionId,
        address: fields.address || undefined,
        latitude: fields.latitude ? Number(fields.latitude) : undefined,
        longitude: fields.longitude ? Number(fields.longitude) : undefined,
        starRating: fields.starRating ? Number(fields.starRating) : undefined,
        roomCount: fields.roomCount ? Number(fields.roomCount) : undefined,
        hotelGroup: fields.hotelGroup || undefined,
        sourcedBy: fields.sourcedBy || undefined,
        notes: fields.notes || undefined,
        contractValue: fields.contractValue || undefined,
        contractStartDate: fields.contractStartDate || undefined,
        contractEndDate: fields.contractEndDate || undefined,
        contractTerms: fields.contractTerms || undefined,
      });
      if ("error" in result) {
        setError(result.error ?? "Unknown error");
        toast.error(result.error ?? "Unknown error");
      } else {
        toast.success("Location created");
        router.push(`/locations/${result.id}`);
      }
    });
  };

  const f = (name: keyof typeof fields, type?: string) => (
    <Input
      type={type ?? "text"}
      value={fields[name]}
      onChange={(e) => setFields((prev) => ({ ...prev, [name]: e.target.value }))}
      className="h-8 text-sm"
    />
  );

  return (
    <div className="space-y-6">
      <DetailSection title="Info">
        <FieldRow label="Name *">
          <Input
            value={fields.name}
            onChange={(e) => setFields((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. The Grand Hotel"
            className="h-8 text-sm"
          />
        </FieldRow>
        <FieldRow label="Customer Code">
          <Input
            value={fields.customerCode}
            onChange={(e) => setFields((prev) => ({ ...prev, customerCode: e.target.value }))}
            placeholder="e.g. RPS-2357 (optional)"
            className="h-8 text-sm"
          />
        </FieldRow>
        <FieldRow label="Region *">
          <select
            value={fields.primaryRegionId}
            onChange={(e) => setFields((prev) => ({ ...prev, primaryRegionId: e.target.value }))}
            className="h-8 w-full rounded-lg border border-border px-2 text-sm"
          >
            <option value="">Select region</option>
            {regionOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Address">{f("address")}</FieldRow>
        <FieldRow label="Latitude">{f("latitude", "number")}</FieldRow>
        <FieldRow label="Longitude">{f("longitude", "number")}</FieldRow>
        <FieldRow label="Star Rating">
          <select
            value={fields.starRating}
            onChange={(e) => setFields((prev) => ({ ...prev, starRating: e.target.value }))}
            className="h-8 w-full rounded-lg border border-border px-2 text-sm"
          >
            <option value="">Select rating</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {"★".repeat(n)} ({n})
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Room Count">{f("roomCount", "number")}</FieldRow>
        <FieldRow label="Hotel Group">{f("hotelGroup")}</FieldRow>
        <FieldRow label="Sourced By">{f("sourcedBy")}</FieldRow>
      </DetailSection>

      <DetailSection title="Key Contacts">
        <p className="text-[12px] text-muted-foreground py-2">
          Key contacts can be added after creating the location.
        </p>
      </DetailSection>

      <DetailSection title="Contract">
        <FieldRow label="Contract Start Date">{f("contractStartDate", "date")}</FieldRow>
        <FieldRow label="Contract End Date">{f("contractEndDate", "date")}</FieldRow>
        <FieldRow label="Contract Value">{f("contractValue", "number")}</FieldRow>
        <FieldRow label="Contract Terms">
          <textarea
            value={fields.contractTerms}
            onChange={(e) => setFields((prev) => ({ ...prev, contractTerms: e.target.value }))}
            rows={3}
            className="w-full rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring resize-y"
          />
        </FieldRow>
        <FieldRow label="Notes">
          <textarea
            value={fields.notes}
            onChange={(e) => setFields((prev) => ({ ...prev, notes: e.target.value }))}
            rows={3}
            className="w-full rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring resize-y"
          />
        </FieldRow>
      </DetailSection>

      <DetailSection title="Banking">
        <p className="text-[12px] text-muted-foreground py-2">
          Banking details can be added after creating the location.
        </p>
      </DetailSection>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button
          onClick={handleCreate}
          disabled={
            isPending ||
            !fields.name.trim() ||
            !fields.primaryRegionId
          }
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isPending ? "Creating…" : "Create location"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing location detail/edit form
// ---------------------------------------------------------------------------

function ExistingLocationForm({
  location,
  canSeeSensitive,
}: {
  location: LocationWithRelations;
  canSeeSensitive: boolean;
}) {
  const router = useRouter();
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [isArchiving, startArchiveTransition] = useTransition();

  // Phase 7.2 — region picker on the existing form. Mirrors NewLocationForm:
  // load client-side so the picker tracks admin renames without a reload.
  // Empty list on fetch failure is fine — the InlineEditField will fall back
  // to showing the current value as a non-editable label.
  const [regionOptions, setRegionOptions] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    listRegionOptions().then(setRegionOptions).catch(() => setRegionOptions([]));
  }, []);

  // Phase 7.4 — internal POC picker. Same load-on-mount pattern. The shared
  // `listUsersForSelect` action returns either an array or an `{ error }`
  // object on RBAC failure; collapse to an empty list so the form still
  // renders for non-admins (the InlineEditField stays read-only when the
  // options array is empty).
  const [pocOptions, setPocOptions] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    listUsersForSelect()
      .then((res) => {
        if (Array.isArray(res)) setPocOptions(res.map((u) => ({ id: u.id, name: u.name })));
        else setPocOptions([]);
      })
      .catch(() => setPocOptions([]));
  }, []);

  // Phase 7.6a — kiosk config group picker. Single-select InlineEditField,
  // editable for member-level (not admin-only) per D13.
  const [configGroupOptions, setConfigGroupOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  useEffect(() => {
    listKioskConfigGroupOptions()
      .then(setConfigGroupOptions)
      .catch(() => setConfigGroupOptions([]));
  }, []);

  // Phase 7.2b — hotel-group picker (multi-select). Server-validated; the
  // form writes via setLocationHotelGroupMemberships which diffs and
  // audit-logs each add/remove. Selected state is held locally so users
  // can chip in/out before confirming with "Save".
  const [hotelGroupOptions, setHotelGroupOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [selectedHotelGroupIds, setSelectedHotelGroupIds] = useState<string[]>(
    location.hotelGroupMemberships.map((m) => m.id),
  );
  const [isSavingHotelGroups, startHotelGroupTransition] = useTransition();
  const [hotelGroupError, setHotelGroupError] = useState<string | null>(null);
  useEffect(() => {
    listHotelGroupOptions()
      .then(setHotelGroupOptions)
      .catch(() => setHotelGroupOptions([]));
  }, []);
  // Reset local selection when the canonical row changes (e.g. RSC refresh
  // after a save) so the picker doesn't drift away from the server state.
  useEffect(() => {
    setSelectedHotelGroupIds(location.hotelGroupMemberships.map((m) => m.id));
  }, [location.hotelGroupMemberships]);

  const hotelGroupsDirty = (() => {
    const current = new Set(location.hotelGroupMemberships.map((m) => m.id));
    if (current.size !== selectedHotelGroupIds.length) return true;
    return selectedHotelGroupIds.some((id) => !current.has(id));
  })();

  const handleSaveHotelGroups = () => {
    startHotelGroupTransition(async () => {
      setHotelGroupError(null);
      const result = await setLocationHotelGroupMemberships(
        location.id,
        selectedHotelGroupIds,
      );
      if ("error" in result) {
        setHotelGroupError(result.error ?? "Failed to update hotel groups");
        return;
      }
      toast.success(
        result.addedCount + result.removedCount === 0
          ? "Hotel groups unchanged"
          : `Hotel groups updated (+${result.addedCount} / −${result.removedCount})`,
      );
      router.refresh();
    });
  };

  // Banking form state
  const [bankingFields, setBankingFields] = useState<Record<string, string>>(
    (location.bankingDetails as Record<string, string>) ?? {
      accountName: "",
      accountNumber: "",
      sortCode: "",
      bankName: "",
    }
  );
  const [isSavingBanking, startBankingTransition] = useTransition();
  const [bankingError, setBankingError] = useState<string | null>(null);

  const saveField = useCallback(
    async (field: string, newValue: string | boolean, oldValue?: string) => {
      const result = await updateLocationField(
        location.id,
        field,
        newValue !== null && newValue !== undefined ? String(newValue) : null,
        oldValue
      );
      if ("error" in result) {
        throw new Error(result.error);
      }
      // Refresh RSC so the inline-edit display renders the saved value.
      // Without this the span falls back to the stale (pre-edit) prop, which
      // makes the change invisible until the user navigates away and back.
      router.refresh();
    },
    [location.id, router]
  );

  const handleArchive = () => {
    startArchiveTransition(async () => {
      const result = await archiveLocation(location.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Location archived");
        setShowArchiveDialog(false);
        router.push("/locations");
      }
    });
  };

  const handleSaveBanking = () => {
    startBankingTransition(async () => {
      setBankingError(null);
      const result = await updateBankingDetails(location.id, bankingFields);
      if ("error" in result) {
        setBankingError(result.error ?? "Failed to save banking details");
      } else {
        toast.success("Banking details saved");
      }
    });
  };

  const starRatingOptions = [1, 2, 3, 4, 5].map((n) => ({
    label: `${"★".repeat(n)} (${n})`,
    value: String(n),
  }));

  // D6 / Task 2.12 — IANA timezone Select. The list is curated (see
  // `COMMON_IANA_TIMEZONES`), but if the location has a value not on it
  // (e.g. set by a future geo-tz refinement) we splice it in so it remains
  // editable rather than silently swapped to the first option.
  const timezoneOptions = (() => {
    const values: string[] = Array.from(COMMON_IANA_TIMEZONES);
    if (location.ianaTimezone && !values.includes(location.ianaTimezone)) {
      values.unshift(location.ianaTimezone);
    }
    return values.map((v) => ({ label: v, value: v }));
  })();

  // Phase 7.1 — outlet-type picker. The empty-string sentinel maps to NULL
  // server-side ("clear classification"), keeping the Select non-empty
  // visually for unclassified rows.
  const locationTypeOptions = [
    { label: "— Unset —", value: "" },
    ...LOCATION_TYPES.map((v) => ({ label: LOCATION_TYPE_LABELS[v], value: v })),
  ];

  // Phase 7.4 — status options. Splice in any unknown current value so a
  // legacy status from before this form change remains editable rather than
  // being silently swapped to the first option.
  const statusOptions = (() => {
    const base: string[] = Array.from(KNOWN_LOCATION_STATUSES);
    if (location.status && !base.includes(location.status)) {
      base.unshift(location.status);
    }
    return [
      { label: "— Unset —", value: "" },
      ...base.map((s) => ({ label: s, value: s })),
    ];
  })();

  const internalPocOptions = [
    { label: "— Unassigned —", value: "" },
    ...pocOptions.map((u) => ({ label: u.name, value: u.id })),
  ];

  const configGroupSelectOptions = [
    { label: "— None —", value: "" },
    ...configGroupOptions.map((g) => ({ label: g.name, value: g.id })),
  ];

  return (
    <div className="space-y-6">
      {/* Archive dialog */}
      <Dialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this location?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This location will be hidden from all views. You can restore it by filtering for
            archived records.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowArchiveDialog(false)}
              disabled={isArchiving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleArchive}
              disabled={isArchiving}
            >
              {isArchiving ? "Archiving…" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive button */}
      <div className="flex justify-end">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowArchiveDialog(true)}
        >
          <Archive className="mr-1.5 h-3.5 w-3.5" />
          Archive
        </Button>
      </div>

      {/* Info section */}
      <DetailSection title="Info">
        <FieldRow label="Name">
          <InlineEditField
            value={location.name}
            fieldName="name"
            type="text"
            onSave={(v) => saveField("name", v, location.name)}
          />
        </FieldRow>
        <FieldRow label="Customer Code">
          <InlineEditField
            value={location.customerCode}
            fieldName="customerCode"
            type="text"
            onSave={(v) => saveField("customerCode", v, location.customerCode ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Region">
          <InlineEditField
            value={location.primaryRegionId}
            fieldName="primaryRegionId"
            type="select"
            options={regionOptions.map((r) => ({ label: r.name, value: r.id }))}
            onSave={(v) => saveField("primaryRegionId", v, location.primaryRegionId)}
          />
        </FieldRow>
        <FieldRow label="Address">
          <InlineEditField
            value={location.address}
            fieldName="address"
            type="text"
            onSave={(v) => saveField("address", v, location.address ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Latitude">
          <InlineEditField
            value={location.latitude !== null ? String(location.latitude) : null}
            fieldName="latitude"
            type="number"
            onSave={(v) =>
              saveField("latitude", v, location.latitude !== null ? String(location.latitude) : undefined)
            }
          />
        </FieldRow>
        <FieldRow label="Longitude">
          <InlineEditField
            value={location.longitude !== null ? String(location.longitude) : null}
            fieldName="longitude"
            type="number"
            onSave={(v) =>
              saveField("longitude", v, location.longitude !== null ? String(location.longitude) : undefined)
            }
          />
        </FieldRow>
        <FieldRow label="Star Rating">
          <InlineEditField
            value={location.starRating !== null ? String(location.starRating) : null}
            fieldName="starRating"
            type="select"
            options={starRatingOptions}
            onSave={(v) =>
              saveField("starRating", v, location.starRating !== null ? String(location.starRating) : undefined)
            }
          />
        </FieldRow>
        <FieldRow label="Room Count">
          <InlineEditField
            value={location.roomCount !== null ? String(location.roomCount) : null}
            fieldName="roomCount"
            type="number"
            onSave={(v) =>
              saveField("roomCount", v, location.roomCount !== null ? String(location.roomCount) : undefined)
            }
          />
        </FieldRow>
        <FieldRow label="Hotel Group">
          <InlineEditField
            value={location.hotelGroup}
            fieldName="hotelGroup"
            type="text"
            onSave={(v) => saveField("hotelGroup", v, location.hotelGroup ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Sourced By">
          <InlineEditField
            value={location.sourcedBy}
            fieldName="sourcedBy"
            type="text"
            onSave={(v) => saveField("sourcedBy", v, location.sourcedBy ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Outlet Type">
          <InlineEditField
            value={location.locationType ?? ""}
            fieldName="locationType"
            type="select"
            options={locationTypeOptions}
            onSave={(v) => saveField("locationType", v, location.locationType ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Timezone">
          <InlineEditField
            value={location.ianaTimezone}
            fieldName="ianaTimezone"
            type="select"
            options={timezoneOptions}
            onSave={(v) => saveField("ianaTimezone", v, location.ianaTimezone)}
          />
        </FieldRow>
      </DetailSection>

      {/* Phase 7.2b / D5 — multi-select hotel-group memberships. JV outlets
          can map to multiple groups; the picker writes to
          location_hotel_group_memberships via a diff action that audit-logs
          each add/remove. */}
      <DetailSection title="Hotel Groups">
        <div className="space-y-2">
          <MultiSelectFilter
            label="Hotel Groups"
            options={hotelGroupOptions.map((g) => ({ value: g.id, label: g.name }))}
            selected={selectedHotelGroupIds}
            onChange={setSelectedHotelGroupIds}
            placeholder="Search hotel groups…"
          />
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">
              {selectedHotelGroupIds.length} group
              {selectedHotelGroupIds.length === 1 ? "" : "s"} selected
            </span>
            <Button
              size="sm"
              onClick={handleSaveHotelGroups}
              disabled={isSavingHotelGroups || !hotelGroupsDirty}
            >
              {isSavingHotelGroups ? "Saving…" : "Save hotel groups"}
            </Button>
          </div>
          {hotelGroupError && (
            <p className="text-[12px] text-destructive">{hotelGroupError}</p>
          )}
        </div>
      </DetailSection>

      {/* Phase 7.4 — Operations section. Picks up the remaining list-only
          fields so admins don't have to bounce to /locations to edit them. */}
      <DetailSection title="Operations">
        <FieldRow label="Status">
          <InlineEditField
            value={location.status ?? ""}
            fieldName="status"
            type="select"
            options={statusOptions}
            onSave={(v) => saveField("status", v, location.status ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Location Group">
          <InlineEditField
            value={location.locationGroup}
            fieldName="locationGroup"
            type="text"
            onSave={(v) => saveField("locationGroup", v, location.locationGroup ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Internal POC">
          <InlineEditField
            value={location.internalPocId ?? ""}
            fieldName="internalPocId"
            type="select"
            options={internalPocOptions}
            onSave={(v) => saveField("internalPocId", v, location.internalPocId ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Kiosk Config Group">
          <div className="flex flex-col gap-1">
            <InlineEditField
              value={location.kioskConfigGroupId ?? ""}
              fieldName="kioskConfigGroupId"
              type="select"
              options={configGroupSelectOptions}
              onSave={(v) =>
                saveField("kioskConfigGroupId", v, location.kioskConfigGroupId ?? undefined)
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Synced from Monday — the next sync will overwrite local edits.
            </p>
          </div>
        </FieldRow>
      </DetailSection>

      {/* Key Contacts section */}
      <DetailSection title="Key Contacts">
        <KeyContactsEditor
          locationId={location.id}
          initialContacts={location.keyContacts}
        />
      </DetailSection>

      {/* Contract section */}
      <DetailSection title="Contract">
        <FieldRow label="Contract Start Date">
          <InlineEditField
            value={location.contractStartDate ? location.contractStartDate.toISOString() : null}
            fieldName="contractStartDate"
            type="date"
            onSave={(v) =>
              saveField("contractStartDate", v, location.contractStartDate?.toISOString() ?? undefined)
            }
          />
        </FieldRow>
        <FieldRow label="Contract End Date">
          <InlineEditField
            value={location.contractEndDate ? location.contractEndDate.toISOString() : null}
            fieldName="contractEndDate"
            type="date"
            onSave={(v) =>
              saveField("contractEndDate", v, location.contractEndDate?.toISOString() ?? undefined)
            }
          />
        </FieldRow>
        <FieldRow label="Contract Value">
          {canSeeSensitive ? (
            <InlineEditField
              value={location.contractValue}
              fieldName="contractValue"
              type="number"
              onSave={(v) => saveField("contractValue", v, location.contractValue ?? undefined)}
            />
          ) : (
            <RestrictedBadge />
          )}
        </FieldRow>
        <FieldRow label="Maintenance Fee">
          {canSeeSensitive ? (
            <InlineEditField
              value={location.maintenanceFee}
              fieldName="maintenanceFee"
              type="number"
              onSave={(v) => saveField("maintenanceFee", v, location.maintenanceFee ?? undefined)}
            />
          ) : (
            <RestrictedBadge />
          )}
        </FieldRow>
        <FieldRow label="Contract Terms">
          {canSeeSensitive ? (
            <InlineEditField
              value={location.contractTerms}
              fieldName="contractTerms"
              type="textarea"
              onSave={(v) => saveField("contractTerms", v, location.contractTerms ?? undefined)}
            />
          ) : (
            <RestrictedBadge />
          )}
        </FieldRow>
        <FieldRow label="Notes">
          <InlineEditField
            value={location.notes}
            fieldName="notes"
            type="textarea"
            onSave={(v) => saveField("notes", v, location.notes ?? undefined)}
          />
        </FieldRow>

        {/* Contract Documents */}
        <div className="mt-4 space-y-2">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            Contract Documents
          </p>
          {canSeeSensitive ? (
            <ContractDocuments
              locationId={location.id}
              initialDocuments={location.contractDocuments}
            />
          ) : (
            <RestrictedBadge />
          )}
        </div>
      </DetailSection>

      {/* Banking section */}
      <DetailSection title="Banking">
        {!canSeeSensitive ? (
          <div className="py-4">
            <RestrictedBadge />
          </div>
        ) : (
          <div className="space-y-3">
            <FieldRow label="Account Name">
              <Input
                value={bankingFields.accountName ?? ""}
                onChange={(e) =>
                  setBankingFields((prev) => ({ ...prev, accountName: e.target.value }))
                }
                className="h-8 text-sm"
              />
            </FieldRow>
            <FieldRow label="Account Number">
              <Input
                value={bankingFields.accountNumber ?? ""}
                onChange={(e) =>
                  setBankingFields((prev) => ({ ...prev, accountNumber: e.target.value }))
                }
                className="h-8 text-sm"
              />
            </FieldRow>
            <FieldRow label="Sort Code">
              <Input
                value={bankingFields.sortCode ?? ""}
                onChange={(e) =>
                  setBankingFields((prev) => ({ ...prev, sortCode: e.target.value }))
                }
                className="h-8 text-sm"
              />
            </FieldRow>
            <FieldRow label="Bank Name">
              <Input
                value={bankingFields.bankName ?? ""}
                onChange={(e) =>
                  setBankingFields((prev) => ({ ...prev, bankName: e.target.value }))
                }
                className="h-8 text-sm"
              />
            </FieldRow>
            {bankingError && (
              <p className="text-[12px] text-destructive">{bankingError}</p>
            )}
            <div className="flex justify-end pt-2">
              <Button
                size="sm"
                onClick={handleSaveBanking}
                disabled={isSavingBanking}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSavingBanking ? "Saving…" : "Save banking details"}
              </Button>
            </div>
          </div>
        )}
      </DetailSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

interface LocationDetailFormProps {
  location?: LocationWithRelations;
  canSeeSensitive: boolean;
}

export function LocationDetailForm({ location, canSeeSensitive }: LocationDetailFormProps) {
  if (!location) {
    // Create mode
    return <NewLocationForm />;
  }

  return (
    <Tabs defaultValue="details">
      <TabsList
        variant="line"
        className="mb-6 border-b border-border w-full rounded-none justify-start"
      >
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="kiosks">Kiosks</TabsTrigger>
        <TabsTrigger value="products">Products</TabsTrigger>
        <TabsTrigger value="audit">Audit</TabsTrigger>
      </TabsList>

      <TabsContent value="details">
        <ExistingLocationForm location={location} canSeeSensitive={canSeeSensitive} />
      </TabsContent>

      <TabsContent value="kiosks">
        <LocationKiosksTab assignments={location.assignedKiosks} />
      </TabsContent>

      <TabsContent value="products">
        <LocationProductsClient locationId={location.id} />
      </TabsContent>

      <TabsContent value="audit">
        <AuditTimeline entityType="location" entityId={location.id} />
      </TabsContent>
    </Tabs>
  );
}
