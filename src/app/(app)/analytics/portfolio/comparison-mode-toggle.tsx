"use client";

import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ComparisonMode } from "@/lib/analytics/types";

interface Props {
  current: ComparisonMode;
}

export function ComparisonModeToggle({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setMode(mode: ComparisonMode) {
    if (mode === current) return;
    const params = new URLSearchParams(searchParams.toString());
    // Default is `mom`, so omit the param to keep URLs clean.
    if (mode === "mom") {
      params.delete("comparison");
    } else {
      params.set("comparison", mode);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5">
      <Button
        size="sm"
        variant={current === "mom" ? "default" : "ghost"}
        className="h-7 px-3 text-xs"
        onClick={() => setMode("mom")}
      >
        MoM
      </Button>
      <Button
        size="sm"
        variant={current === "yoy" ? "default" : "ghost"}
        className="h-7 px-3 text-xs"
        onClick={() => setMode("yoy")}
      >
        YoY
      </Button>
    </div>
  );
}
