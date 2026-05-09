"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

// Phase 8 Plan 08-02 — Self-serve change-password form (EMAIL-02 SC2).
//
// Wire-shape:
//   1. authClient.changePassword({ ..., revokeOtherSessions: true })  // D-10
//   2. on success → fire-and-forget POST /api/account/password-changed
//      → fires inngest.send({ name: 'email/send.requested', kind: 'password_changed', ... })
//      A confirmation-email failure must not block the success toast — the
//      password rotation itself already succeeded (see RESEARCH § Pattern 4
//      lines 489-492 and the threat model T-08.02-08 row).
//   3. toast surfaces "Other sessions signed out" so the user knows what
//      revokeOtherSessions:true did (D-10 surface).
//
// Convention: client form uses plain `import { z } from "zod"` (NOT zod/v4 —
// that's the server-action convention per src/app/(app)/settings/users/actions.ts).
//
// Exported so the contract test in change-password-form.test.ts asserts against
// THE schema, not a copy that can drift silently.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string().min(1, "Please confirm your new password"),
  })
  .refine((d) => d.newPassword === d.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type Values = z.infer<typeof changePasswordSchema>;

export function ChangePasswordForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<Values>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  async function onSubmit(data: Values) {
    setIsLoading(true);
    try {
      const result = await authClient.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        revokeOtherSessions: true, // D-10
      });
      if ("error" in result && result.error) {
        toast.error(result.error.message ?? "Failed to change password");
        return;
      }
      // Fire-and-forget the confirmation email via the Inngest substrate
      // (plan 08-01 sendEmailFn → password-changed template). A failure of
      // this fetch must NOT block the user-visible success toast: the
      // password rotation itself has already succeeded.
      void fetch("/api/account/password-changed", { method: "POST" }).catch(
        () => {
          /* swallow — confirmation email is non-critical UX */
        },
      );
      toast.success("Password changed. Other sessions signed out.");
      reset();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="currentPassword" className="text-sm text-foreground">
          Current password
          <span className="text-destructive ml-0.5">*</span>
        </Label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.currentPassword}
          className="border-border focus:border-primary focus:ring-ring"
          {...register("currentPassword")}
        />
        {errors.currentPassword && (
          <p
            role="alert"
            className="flex items-center gap-1 text-xs text-destructive"
          >
            <AlertCircle className="size-3.5 shrink-0" />
            {errors.currentPassword.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="newPassword" className="text-sm text-foreground">
          New password
          <span className="text-destructive ml-0.5">*</span>
        </Label>
        <div className="relative">
          <Input
            id="newPassword"
            type={showNew ? "text" : "password"}
            autoComplete="new-password"
            aria-invalid={!!errors.newPassword}
            className="border-border pr-10 focus:border-primary focus:ring-ring"
            {...register("newPassword")}
          />
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showNew ? "Hide password" : "Show password"}
          >
            {showNew ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">At least 8 characters</p>
        {errors.newPassword && (
          <p
            role="alert"
            className="flex items-center gap-1 text-xs text-destructive"
          >
            <AlertCircle className="size-3.5 shrink-0" />
            {errors.newPassword.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm" className="text-sm text-foreground">
          Confirm new password
          <span className="text-destructive ml-0.5">*</span>
        </Label>
        <div className="relative">
          <Input
            id="confirm"
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            aria-invalid={!!errors.confirm}
            className="border-border pr-10 focus:border-primary focus:ring-ring"
            {...register("confirm")}
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={showConfirm ? "Hide password" : "Show password"}
          >
            {showConfirm ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
        {errors.confirm && (
          <p
            role="alert"
            className="flex items-center gap-1 text-xs text-destructive"
          >
            <AlertCircle className="size-3.5 shrink-0" />
            {errors.confirm.message}
          </p>
        )}
      </div>

      <Button
        type="submit"
        disabled={isLoading}
        className="mt-2 self-start bg-primary text-white hover:bg-primary font-medium"
        style={{ borderRadius: "8px" }}
      >
        {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
        Change password
      </Button>
    </form>
  );
}
