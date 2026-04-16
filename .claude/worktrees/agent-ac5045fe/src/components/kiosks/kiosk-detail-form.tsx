"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Archive, MapPin, Search, Plus } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { InlineEditField } from "@/components/ui/inline-edit-field";
import { AssignmentHistory } from "@/components/kiosks/assignment-history";
import { AuditTimeline } from "@/components/audit/audit-timeline";
import {
  createKiosk,
  updateKioskField,
  archiveKiosk,
  assignKiosk,
  reassignKiosk,
} from "@/app/(app)/kiosks/actions";
import type { KioskWithRelations } from "@/app/(app)/kiosks/actions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PipelineStage = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type LocationOption = { id: string; name: string };

interface KioskDetailFormProps {
  kiosk?: KioskWithRelations;
  pipelineStages: PipelineStage[];
  locations: LocationOption[];
}

// ---------------------------------------------------------------------------
// Section header component
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  open,
}: {
  title: string;
  open: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <h3 className="text-sm font-medium uppercase tracking-wide text-wk-night-grey">
        {title}
      </h3>
      {open ? (
        <ChevronUp className="h-4 w-4 text-wk-mid-grey" />
      ) : (
        <ChevronDown className="h-4 w-4 text-wk-mid-grey" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field row component — label + inline edit field
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
      <Label className="pt-1 text-[12px] font-normal text-wk-night-grey">{label}</Label>
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
      <CollapsibleTrigger className="w-full border-b border-wk-mid-grey text-left">
        <SectionHeader title={title} open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="py-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// New Kiosk create form fields
// ---------------------------------------------------------------------------

function NewKioskForm({
  pipelineStages,
  locations: locationOptions,
}: {
  pipelineStages: PipelineStage[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fields, setFields] = useState({
    kioskId: "",
    outletCode: "",
    customerCode1: "",
    customerCode2: "",
    hardwareModel: "",
    hardwareSerialNumber: "",
    softwareVersion: "",
    cmsConfigStatus: "",
    installationDate: "",
    maintenanceFee: "",
    freeTrialStatus: false,
    freeTrialEndDate: "",
    regionGroup: "",
    pipelineStageId: "",
    notes: "",
    deploymentPhaseTags: "",
  });
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    startTransition(async () => {
      setError(null);
      const result = await createKiosk({
        ...fields,
        deploymentPhaseTags: fields.deploymentPhaseTags
          ? fields.deploymentPhaseTags.split(",").map((t) => t.trim()).filter(Boolean)
          : [],
      });
      if ("error" in result) {
        setError(result.error ?? "Unknown error");
        toast.error(result.error ?? "Unknown error");
      } else {
        toast.success("Kiosk created");
        router.push(`/kiosks/${result.id}`);
      }
    });
  };

  const field = (name: keyof typeof fields) => (
    <Input
      value={String(fields[name])}
      onChange={(e) => setFields((f) => ({ ...f, [name]: e.target.value }))}
      className="h-8 text-sm"
    />
  );

  return (
    <div className="space-y-6">
      <DetailSection title="Identity">
        <FieldRow label="Kiosk ID *">
          <Input
            value={fields.kioskId}
            onChange={(e) => setFields((f) => ({ ...f, kioskId: e.target.value }))}
            placeholder="e.g. KSK-001"
            className="h-8 text-sm"
          />
        </FieldRow>
        <FieldRow label="Outlet Code">{field("outletCode")}</FieldRow>
        <FieldRow label="Customer Code 1">{field("customerCode1")}</FieldRow>
        <FieldRow label="Customer Code 2">{field("customerCode2")}</FieldRow>
      </DetailSection>

      <DetailSection title="Hardware & Software">
        <FieldRow label="Hardware Model">{field("hardwareModel")}</FieldRow>
        <FieldRow label="Serial Number">{field("hardwareSerialNumber")}</FieldRow>
        <FieldRow label="Software Version">{field("softwareVersion")}</FieldRow>
        <FieldRow label="CMS Config Status">{field("cmsConfigStatus")}</FieldRow>
      </DetailSection>

      <DetailSection title="Deployment">
        <FieldRow label="Installation Date">
          <Input
            type="date"
            value={fields.installationDate}
            onChange={(e) => setFields((f) => ({ ...f, installationDate: e.target.value }))}
            className="h-8 text-sm"
          />
        </FieldRow>
        <FieldRow label="Pipeline Stage">
          <select
            value={fields.pipelineStageId}
            onChange={(e) => setFields((f) => ({ ...f, pipelineStageId: e.target.value }))}
            className="h-8 w-full rounded-lg border border-wk-mid-grey px-2 text-sm"
          >
            <option value="">Select stage</option>
            {pipelineStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Deployment Phase Tags">
          <Input
            value={fields.deploymentPhaseTags}
            onChange={(e) => setFields((f) => ({ ...f, deploymentPhaseTags: e.target.value }))}
            placeholder="Comma-separated tags"
            className="h-8 text-sm"
          />
        </FieldRow>
        <FieldRow label="Region / Group">{field("regionGroup")}</FieldRow>
      </DetailSection>

      <DetailSection title="Billing">
        <FieldRow label="Maintenance Fee">
          <Input
            type="number"
            value={fields.maintenanceFee}
            onChange={(e) => setFields((f) => ({ ...f, maintenanceFee: e.target.value }))}
            className="h-8 text-sm"
          />
        </FieldRow>
        <FieldRow label="Notes">{field("notes")}</FieldRow>
      </DetailSection>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button
          onClick={handleCreate}
          disabled={isPending || !fields.kioskId}
          className="bg-wk-azure text-white hover:bg-wk-azure/90"
        >
          {isPending ? "Creating…" : "Create kiosk"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing kiosk detail/edit form
// ---------------------------------------------------------------------------

function ExistingKioskForm({
  kiosk,
  pipelineStages,
  locations: locationOptions,
}: {
  kiosk: KioskWithRelations;
  pipelineStages: PipelineStage[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [isArchiving, startArchiveTransition] = useTransition();
  const [isAssigning, startAssignTransition] = useTransition();
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const filteredLocations = locationOptions.filter((l) =>
    l.name.toLowerCase().includes(locationSearch.toLowerCase())
  );

  const saveField = useCallback(
    async (field: string, newValue: string | boolean, oldValue?: string) => {
      const result = await updateKioskField(kiosk.id, field, newValue, oldValue);
      if ("error" in result) {
        throw new Error(result.error);
      }
    },
    [kiosk.id]
  );

  const handleArchive = () => {
    startArchiveTransition(async () => {
      const result = await archiveKiosk(kiosk.id);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Kiosk archived");
        setShowArchiveDialog(false);
        router.push("/kiosks");
      }
    });
  };

  const handleAssign = () => {
    if (!selectedLocationId) return;
    startAssignTransition(async () => {
      const fn = kiosk.currentAssignment ? reassignKiosk : assignKiosk;
      const result = await fn(kiosk.id, selectedLocationId, assignReason || undefined);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(kiosk.currentAssignment ? "Kiosk reassigned" : "Kiosk assigned");
        setShowAssignDialog(false);
        router.refresh();
      }
    });
  };

  const pipelineOptions = pipelineStages.map((s) => ({
    label: s.name,
    value: s.id,
  }));

  return (
    <div className="space-y-6">
      {/* Archive dialog */}
      <Dialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this kiosk?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-wk-night-grey">
            This kiosk will be hidden from all views. You can restore it by filtering for
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

      {/* Archive trigger button — rendered in parent AppShell via props */}
      {/* We expose it as a prop callback instead */}

      {/* Venue assignment dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {kiosk.currentAssignment ? "Reassign venue" : "Assign venue"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-wk-mid-grey" />
              <Input
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                placeholder="Search locations…"
                className="pl-8"
              />
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-wk-mid-grey">
              {filteredLocations.length === 0 ? (
                <p className="p-4 text-center text-sm text-wk-night-grey">
                  No locations found
                </p>
              ) : (
                filteredLocations.map((loc) => (
                  <button
                    key={loc.id}
                    onClick={() => setSelectedLocationId(loc.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-wk-light-grey",
                      selectedLocationId === loc.id &&
                        "bg-wk-sky-blue text-wk-graphite"
                    )}
                  >
                    <MapPin className="h-3.5 w-3.5 text-wk-mid-grey" />
                    {loc.name}
                  </button>
                ))
              )}
            </div>
            <div>
              <Label className="text-[12px] text-wk-night-grey">Reason (optional)</Label>
              <Input
                value={assignReason}
                onChange={(e) => setAssignReason(e.target.value)}
                placeholder="e.g. Relocated for trial"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAssignDialog(false)}
              disabled={isAssigning}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={isAssigning || !selectedLocationId}
              className="bg-wk-azure text-white hover:bg-wk-azure/90"
            >
              {isAssigning
                ? "Saving…"
                : kiosk.currentAssignment
                ? "Reassign venue"
                : "Assign venue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive button — inline in section for now; detail page can also add to header */}
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

      {/* Identity section */}
      <DetailSection title="Identity">
        <FieldRow label="Kiosk ID">
          <InlineEditField
            value={kiosk.kioskId}
            fieldName="kioskId"
            type="text"
            onSave={(v) => saveField("kioskId", v, kiosk.kioskId)}
          />
        </FieldRow>
        <FieldRow label="Outlet Code">
          <InlineEditField
            value={kiosk.outletCode}
            fieldName="outletCode"
            type="text"
            onSave={(v) => saveField("outletCode", v, kiosk.outletCode ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Customer Code 1">
          <InlineEditField
            value={kiosk.customerCode1}
            fieldName="customerCode1"
            type="text"
            onSave={(v) => saveField("customerCode1", v, kiosk.customerCode1 ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Customer Code 2">
          <InlineEditField
            value={kiosk.customerCode2}
            fieldName="customerCode2"
            type="text"
            onSave={(v) => saveField("customerCode2", v, kiosk.customerCode2 ?? undefined)}
          />
        </FieldRow>
      </DetailSection>

      {/* Hardware & Software section */}
      <DetailSection title="Hardware & Software">
        <FieldRow label="Hardware Model">
          <InlineEditField
            value={kiosk.hardwareModel}
            fieldName="hardwareModel"
            type="text"
            onSave={(v) => saveField("hardwareModel", v, kiosk.hardwareModel ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Serial Number">
          <InlineEditField
            value={kiosk.hardwareSerialNumber}
            fieldName="hardwareSerialNumber"
            type="text"
            onSave={(v) =>
              saveField("hardwareSerialNumber", v, kiosk.hardwareSerialNumber ?? undefined)
            }
          />
        </FieldRow>
        <FieldRow label="Software Version">
          <InlineEditField
            value={kiosk.softwareVersion}
            fieldName="softwareVersion"
            type="text"
            onSave={(v) => saveField("softwareVersion", v, kiosk.softwareVersion ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="CMS Config Status">
          <InlineEditField
            value={kiosk.cmsConfigStatus === "configured"}
            fieldName="cmsConfigStatus"
            type="switch"
            onSave={(v) =>
              saveField("cmsConfigStatus", v, kiosk.cmsConfigStatus ?? undefined)
            }
          />
          <span className="text-[12px] text-wk-night-grey">
            {kiosk.cmsConfigStatus === "configured" ? "Configured" : "Not configured"}
          </span>
        </FieldRow>
      </DetailSection>

      {/* Deployment section */}
      <DetailSection title="Deployment">
        <FieldRow label="Installation Date">
          <InlineEditField
            value={kiosk.installationDate ? kiosk.installationDate.toISOString() : null}
            fieldName="installationDate"
            type="date"
            onSave={(v) =>
              saveField(
                "installationDate",
                v,
                kiosk.installationDate?.toISOString() ?? undefined
              )
            }
          />
        </FieldRow>
        <FieldRow label="Pipeline Stage">
          <InlineEditField
            value={kiosk.pipelineStageId}
            fieldName="pipelineStageId"
            type="select"
            options={pipelineOptions}
            onSave={(v) =>
              saveField("pipelineStageId", v, kiosk.pipelineStageId ?? undefined)
            }
          />
        </FieldRow>
        <FieldRow label="Deployment Tags">
          <InlineEditField
            value={kiosk.deploymentPhaseTags?.join(", ") ?? null}
            fieldName="deploymentPhaseTags"
            type="text"
            placeholder="Comma-separated tags"
            onSave={(v) =>
              saveField(
                "deploymentPhaseTags",
                v,
                kiosk.deploymentPhaseTags?.join(", ") ?? undefined
              )
            }
          />
        </FieldRow>
        <FieldRow label="Region / Group">
          <InlineEditField
            value={kiosk.regionGroup}
            fieldName="regionGroup"
            type="text"
            onSave={(v) => saveField("regionGroup", v, kiosk.regionGroup ?? undefined)}
          />
        </FieldRow>

        {/* Current venue */}
        <FieldRow label="Current Venue">
          <div className="flex items-center gap-2">
            <span className="text-sm text-wk-graphite">
              {kiosk.currentAssignment?.locationName ?? (
                <span className="text-wk-mid-grey">Not assigned</span>
              )}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLocationSearch("");
                setSelectedLocationId(
                  kiosk.currentAssignment?.locationId ?? ""
                );
                setAssignReason("");
                setShowAssignDialog(true);
              }}
              className="h-7 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" />
              {kiosk.currentAssignment ? "Reassign venue" : "Assign venue"}
            </Button>
          </div>
        </FieldRow>

        {/* Assignment history sub-section */}
        <div className="ml-[196px] mt-3">
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-[12px] text-wk-night-grey hover:text-wk-graphite">
              {historyOpen ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              Assignment History
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3">
                <AssignmentHistory history={kiosk.assignmentHistory} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DetailSection>

      {/* Billing section */}
      <DetailSection title="Billing">
        <FieldRow label="Maintenance Fee">
          <InlineEditField
            value={kiosk.maintenanceFee}
            fieldName="maintenanceFee"
            type="number"
            onSave={(v) => saveField("maintenanceFee", v, kiosk.maintenanceFee ?? undefined)}
          />
        </FieldRow>
        <FieldRow label="Free Trial">
          <InlineEditField
            value={kiosk.freeTrialStatus}
            fieldName="freeTrialStatus"
            type="switch"
            onSave={(v) =>
              saveField("freeTrialStatus", v, kiosk.freeTrialStatus?.toString() ?? undefined)
            }
          />
        </FieldRow>
        {kiosk.freeTrialStatus && (
          <FieldRow label="Trial End Date">
            <InlineEditField
              value={kiosk.freeTrialEndDate ? kiosk.freeTrialEndDate.toISOString() : null}
              fieldName="freeTrialEndDate"
              type="date"
              onSave={(v) =>
                saveField(
                  "freeTrialEndDate",
                  v,
                  kiosk.freeTrialEndDate?.toISOString() ?? undefined
                )
              }
            />
          </FieldRow>
        )}
        <FieldRow label="Notes">
          <InlineEditField
            value={kiosk.notes}
            fieldName="notes"
            type="textarea"
            onSave={(v) => saveField("notes", v, kiosk.notes ?? undefined)}
          />
        </FieldRow>
      </DetailSection>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function KioskDetailForm({
  kiosk,
  pipelineStages,
  locations,
}: KioskDetailFormProps) {
  if (!kiosk) {
    // Create mode
    return (
      <NewKioskForm pipelineStages={pipelineStages} locations={locations} />
    );
  }

  return (
    <Tabs defaultValue="details">
      <TabsList variant="line" className="mb-6 border-b border-wk-mid-grey w-full rounded-none justify-start">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="audit">Audit</TabsTrigger>
      </TabsList>

      <TabsContent value="details">
        <ExistingKioskForm
          kiosk={kiosk}
          pipelineStages={pipelineStages}
          locations={locations}
        />
      </TabsContent>

      <TabsContent value="audit">
        <AuditTimeline entityType="kiosk" entityId={kiosk.id} />
      </TabsContent>
    </Tabs>
  );
}
