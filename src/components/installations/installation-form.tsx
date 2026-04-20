"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createInstallation,
  updateInstallation,
} from "@/app/(app)/installations/actions";
import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  region: z.string().optional(),
  status: z.enum(["planned", "active", "complete"]),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InstallationFormProps {
  installation?: InstallationWithRelations;
  installationId?: string;
}

// ---------------------------------------------------------------------------
// InstallationForm
// ---------------------------------------------------------------------------

export function InstallationForm({
  installation,
  installationId,
}: InstallationFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = !!installationId;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: installation?.name ?? "",
      region: installation?.region ?? "",
      status: (installation?.status as FormValues["status"]) ?? "planned",
      plannedStart: installation?.plannedStart
        ? format(installation.plannedStart, "yyyy-MM-dd")
        : "",
      plannedEnd: installation?.plannedEnd
        ? format(installation.plannedEnd, "yyyy-MM-dd")
        : "",
    },
  });

  const statusValue = watch("status");

  function onSubmit(data: FormValues) {
    startTransition(async () => {
      if (isEdit && installationId) {
        const result = await updateInstallation(installationId, data);
        if ("error" in result) {
          toast.error(
            "Couldn't save installation. Check all required fields and try again."
          );
        } else {
          toast.success("Installation updated");
          router.refresh();
        }
      } else {
        const result = await createInstallation(data);
        if ("error" in result) {
          toast.error(
            "Couldn't save installation. Check all required fields and try again."
          );
        } else {
          toast.success("Installation created");
          router.push(`/installations/${result.id}`);
        }
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          placeholder="e.g. Sydney Airport T2 Roll-out"
          {...register("name")}
          aria-invalid={!!errors.name}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      {/* Region */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="region">Region</Label>
        <Input
          id="region"
          placeholder="e.g. NSW"
          {...register("region")}
        />
      </div>

      {/* Status */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status">Status</Label>
        <Select
          value={statusValue}
          items={[
            { value: "planned", label: "Planned" },
            { value: "active", label: "Active" },
            { value: "complete", label: "Complete" },
          ]}
          onValueChange={(v) => {
            if (v)
              setValue("status", v as FormValues["status"], {
                shouldValidate: true,
              });
          }}
        >
          <SelectTrigger id="status" className="w-full">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="planned">Planned</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Planned Start */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plannedStart">Planned Start</Label>
        <Input
          id="plannedStart"
          type="date"
          {...register("plannedStart")}
        />
      </div>

      {/* Planned End */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plannedEnd">Planned End</Label>
        <Input
          id="plannedEnd"
          type="date"
          {...register("plannedEnd")}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          type="submit"
          disabled={isPending}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isPending
            ? isEdit
              ? "Saving…"
              : "Creating…"
            : isEdit
              ? "Save installation"
              : "Create installation"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
