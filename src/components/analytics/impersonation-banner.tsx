"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AlertTriangle, X } from "lucide-react";
import { stopImpersonation } from "@/app/(app)/settings/users/impersonation-actions";
import { Button } from "@/components/ui/button";

interface ImpersonationBannerProps {
  userName: string;
}

export function ImpersonationBanner({ userName }: ImpersonationBannerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleExit() {
    startTransition(async () => {
      await stopImpersonation();
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-amber-900">
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="size-4 shrink-0" />
        <span>
          Viewing as: <strong>{userName}</strong>
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
        onClick={handleExit}
        disabled={isPending}
      >
        <X className="size-3.5" />
        Exit
      </Button>
    </div>
  );
}
