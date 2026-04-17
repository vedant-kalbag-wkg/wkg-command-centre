"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { inviteUser } from "@/app/(app)/settings/users/actions";
import type { Role } from "@/lib/rbac";
import type { DimensionType } from "@/lib/scoping/scoped-query";
import { DIMENSION_OPTIONS } from "@/lib/scoping/dimension-options";

const inviteSchema = z.object({
  email: z.email("Please enter a valid email address"),
  role: z.enum(["admin", "member", "viewer"], {
    error: "Please select a role",
  }),
  userType: z.enum(["internal", "external"]),
});

type InviteFormData = z.infer<typeof inviteSchema>;

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function InviteUserDialog({
  open,
  onOpenChange,
  onSuccess,
}: InviteUserDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scopes, setScopes] = useState<
    { dimensionType: DimensionType; dimensionId: string }[]
  >([]);
  const [newDimType, setNewDimType] = useState<DimensionType>("hotel_group");
  const [newDimId, setNewDimId] = useState("");
  const [scopeError, setScopeError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      role: "member",
      userType: "internal",
    },
  });

  const selectedRole = watch("role");
  const watchedUserType = watch("userType");

  function resetForm() {
    reset();
    setScopes([]);
    setNewDimId("");
    setScopeError(null);
  }

  async function onSubmit(data: InviteFormData) {
    if (data.userType === "external" && scopes.length === 0) {
      setScopeError("External users require at least one scope");
      return;
    }
    setScopeError(null);
    setIsSubmitting(true);
    try {
      const result = await inviteUser(
        data.email,
        data.role as Role,
        data.userType,
        scopes,
      );
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`Invite sent to ${data.email}`);
        resetForm();
        onOpenChange(false);
        onSuccess();
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetForm();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Send an invite email to add a new team member.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="invite-email">
              Email address <span className="text-wk-night-grey">*</span>
            </Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="name@example.com"
              {...register("email")}
              aria-invalid={!!errors.email}
            />
            {errors.email && (
              <p className="text-xs text-[#F41E56]" role="alert">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="invite-role">
              Role <span className="text-wk-night-grey">*</span>
            </Label>
            <Select
              value={selectedRole}
              onValueChange={(val) => {
                if (val) {
                  setValue("role", val as InviteFormData["role"], {
                    shouldValidate: true,
                  });
                }
              }}
            >
              <SelectTrigger className="w-full" id="invite-role">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            {errors.role && (
              <p className="text-xs text-[#F41E56]" role="alert">
                {errors.role.message}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="invite-user-type">User type</Label>
            <Select
              value={watchedUserType}
              onValueChange={(val) => {
                if (val) {
                  setValue("userType", val as "internal" | "external", {
                    shouldValidate: true,
                  });
                }
                if (val === "internal") setScopes([]);
              }}
            >
              <SelectTrigger className="w-full" id="invite-user-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">
                  Internal (team member)
                </SelectItem>
                <SelectItem value="external">
                  External (partner/venue)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {watchedUserType === "external" && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="text-sm font-medium">
                Scopes{" "}
                <span className="text-wk-night-grey font-normal">
                  (required for external users)
                </span>
              </div>

              {scopes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {scopes.map((s, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs"
                    >
                      {
                        DIMENSION_OPTIONS.find(
                          (o) => o.value === s.dimensionType,
                        )?.label
                      }
                      : {s.dimensionId}
                      <button
                        type="button"
                        onClick={() =>
                          setScopes((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="scope-dim-type" className="text-xs">
                    Dimension type
                  </Label>
                  <Select
                    value={newDimType}
                    onValueChange={(val) =>
                      val && setNewDimType(val as DimensionType)
                    }
                  >
                    <SelectTrigger
                      className="w-full h-8 text-xs"
                      id="scope-dim-type"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIMENSION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="scope-dim-id" className="text-xs">
                    Dimension ID
                  </Label>
                  <Input
                    id="scope-dim-id"
                    value={newDimId}
                    onChange={(e) => setNewDimId(e.target.value)}
                    placeholder="e.g. hotel-group-uuid"
                    className="h-8 text-xs"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!newDimId.trim()}
                  onClick={() => {
                    setScopes((prev) => [
                      ...prev,
                      {
                        dimensionType: newDimType,
                        dimensionId: newDimId.trim(),
                      },
                    ]);
                    setNewDimId("");
                  }}
                >
                  Add
                </Button>
              </div>

              {scopeError && (
                <p className="text-xs text-[#F41E56]" role="alert">
                  {scopeError}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Send invite
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
