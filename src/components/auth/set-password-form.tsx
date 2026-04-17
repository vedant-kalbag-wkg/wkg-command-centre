"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { getInviteContext } from "@/app/(auth)/set-password/actions";

const setPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SetPasswordFormValues = z.infer<typeof setPasswordSchema>;

export function SetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const isInvite = searchParams.get("invite") === "1";
  const inviteEmail = searchParams.get("email") || "";

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inviteCtx, setInviteCtx] = useState<{
    userType: string;
    scopes: { dimensionType: string; dimensionLabel: string; dimensionName: string }[];
  } | null>(null);

  useEffect(() => {
    if (isInvite && inviteEmail) {
      getInviteContext(inviteEmail).then(setInviteCtx).catch(() => {});
    }
  }, [isInvite, inviteEmail]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetPasswordFormValues>({
    resolver: zodResolver(setPasswordSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  async function onSubmit(data: SetPasswordFormValues) {
    setIsLoading(true);
    try {
      await authClient.resetPassword({
        newPassword: data.password,
        token,
      });
      toast.success("Password set successfully");
      router.push("/login");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {inviteCtx && inviteCtx.scopes.length > 0 && (
        <div className="rounded-lg border border-[#00A6D3]/20 bg-[#00A6D3]/5 p-4">
          <p className="text-sm font-medium text-wk-graphite mb-2">
            You&apos;ll have access to:
          </p>
          <ul className="text-sm text-wk-night-grey space-y-1">
            {inviteCtx.scopes.map((s, i) => (
              <li key={i}>
                &bull; {s.dimensionName}{" "}
                <span className="text-xs text-muted-foreground">
                  ({s.dimensionLabel})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="text-xl font-bold tracking-[-0.01em] text-wk-graphite">
        {isInvite ? "Welcome — set your password" : "Set your password"}
      </h2>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-sm text-wk-graphite">
            New password
            <span className="text-wk-night-grey ml-0.5">*</span>
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter new password"
              aria-invalid={!!errors.password}
              className="border-wk-mid-grey pr-10 focus:border-wk-azure focus:ring-wk-azure"
              {...register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-wk-night-grey hover:text-wk-graphite"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          <p className="text-xs text-wk-night-grey">At least 8 characters</p>
          {errors.password && (
            <p className="flex items-center gap-1 text-xs text-wk-destructive" role="alert">
              <AlertCircle className="size-3.5 shrink-0" />
              {errors.password.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label
            htmlFor="confirmPassword"
            className="text-sm text-wk-graphite"
          >
            Confirm password
            <span className="text-wk-night-grey ml-0.5">*</span>
          </Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirm your password"
              aria-invalid={!!errors.confirmPassword}
              className="border-wk-mid-grey pr-10 focus:border-wk-azure focus:ring-wk-azure"
              {...register("confirmPassword")}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-wk-night-grey hover:text-wk-graphite"
              aria-label={
                showConfirmPassword ? "Hide password" : "Show password"
              }
            >
              {showConfirmPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
          {errors.confirmPassword && (
            <p className="flex items-center gap-1 text-xs text-wk-destructive" role="alert">
              <AlertCircle className="size-3.5 shrink-0" />
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 bg-wk-azure text-white hover:bg-wk-sea-blue font-medium"
          style={{ borderRadius: "8px" }}
        >
          {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
          Set password
        </Button>
      </form>
    </div>
  );
}
