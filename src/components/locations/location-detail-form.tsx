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
  updateLocationField,
  archiveLocation,
  updateBankingDetails,
} from "@/app/(app)/locations/actions";
import type { LocationWithRelations } from "@/app/(app)/locations/actions";
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
    outletCode: "",
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
        outletCode: fields.outletCode,
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
        <FieldRow label="Outlet Code *">
          <Input
            value={fields.outletCode}
            onChange={(e) => setFields((prev) => ({ ...prev, outletCode: e.target.value }))}
            placeholder="e.g. GRAND-001"
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
            !fields.outletCode.trim() ||
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
