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
import { createUserWithPassword } from "@/app/(app)/settings/users/actions";
import type { Role } from "@/lib/rbac";

const createSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.email("Please enter a valid email address"),
    role: z.enum(["admin", "member", "viewer"], {
      error: "Please select a role",
    }),
    password: z.string().min(8, "Password must be at least 8 characters"),
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords do not match",
    path: ["passwordConfirm"],
  });

type CreateFormData = z.infer<typeof createSchema>;

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateUserDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateUserDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      email: "",
      role: "member",
      password: "",
      passwordConfirm: "",
    },
  });

  const selectedRole = watch("role");

  async function onSubmit(data: CreateFormData) {
    setIsSubmitting(true);
    try {
      const result = await createUserWithPassword(
        data.name,
        data.email,
        data.role as Role,
        data.password,
      );
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(`User created: ${data.email}`);
        reset();
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
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            Create a user directly with a password. They can log in immediately
            — no email is sent.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="create-name">
              Name <span className="text-wk-night-grey">*</span>
            </Label>
            <Input
              id="create-name"
              type="text"
              placeholder="Jane Doe"
              {...register("name")}
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-[#F41E56]" role="alert">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-email">
              Email address <span className="text-wk-night-grey">*</span>
            </Label>
            <Input
              id="create-email"
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
            <Label htmlFor="create-role">
              Role <span className="text-wk-night-grey">*</span>
            </Label>
            <Select
              value={selectedRole}
              onValueChange={(val) => {
                if (val) {
                  setValue("role", val as CreateFormData["role"], {
                    shouldValidate: true,
                  });
                }
              }}
            >
              <SelectTrigger className="w-full" id="create-role">
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
            <Label htmlFor="create-password">
              Password <span className="text-wk-night-grey">*</span>
            </Label>
            <Input
              id="create-password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              {...register("password")}
              aria-invalid={!!errors.password}
            />
            {errors.password && (
              <p className="text-xs text-[#F41E56]" role="alert">
                {errors.password.message}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-password-confirm">
              Confirm password <span className="text-wk-night-grey">*</span>
            </Label>
            <Input
              id="create-password-confirm"
              type="password"
              autoComplete="new-password"
              {...register("passwordConfirm")}
              aria-invalid={!!errors.passwordConfirm}
            />
            {errors.passwordConfirm && (
              <p className="text-xs text-[#F41E56]" role="alert">
                {errors.passwordConfirm.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Create user
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
