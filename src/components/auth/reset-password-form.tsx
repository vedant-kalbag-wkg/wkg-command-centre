"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const resetSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
});

type ResetFormValues = z.infer<typeof resetSchema>;

export function ResetPasswordForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
  });

  async function onSubmit(data: ResetFormValues) {
    setIsLoading(true);
    try {
      // Better Auth generates forgetPassword at runtime from emailAndPassword config
      // but types don't export it without direct server config inference
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (authClient as any).forgetPassword({
        email: data.email,
        redirectTo: "/set-password",
      });
      setSentTo(data.email);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-bold tracking-[-0.01em] text-foreground">
          Check your inbox
        </h2>
        <p className="text-sm text-muted-foreground">
          We sent a reset link to{" "}
          <span className="font-medium text-foreground">{sentTo}</span>. Check
          your spam folder if it doesn&apos;t arrive within a few minutes.
        </p>
        <a
          href="/login"
          className="text-sm text-primary hover:text-primary"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <a
        href="/login"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary w-fit"
      >
        <ArrowLeft className="size-4" />
        Back to sign in
      </a>

      <h2 className="text-xl font-bold tracking-[-0.01em] text-foreground">
        Reset your password
      </h2>

      <p className="text-sm text-muted-foreground">
        Enter your email and we&apos;ll send you a link to reset your password.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-sm text-foreground">
            Email address
            <span className="text-muted-foreground ml-0.5">*</span>
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            className="border-border focus:border-primary focus:ring-ring"
            {...register("email")}
          />
          {errors.email && (
            <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
              <AlertCircle className="size-3.5 shrink-0" />
              {errors.email.message}
            </p>
          )}
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 bg-primary text-white hover:bg-primary font-medium"
          style={{ borderRadius: "8px" }}
        >
          {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
          Send reset link
        </Button>
      </form>
    </div>
  );
}
