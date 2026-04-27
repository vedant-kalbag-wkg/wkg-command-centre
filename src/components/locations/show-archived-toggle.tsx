"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Phase 7.8 — Show-archived toggle for the locations list. Drives the
// `?archived=1` query param so the server-rendered page can read it and
// pass `includeArchived` into `listLocations`.
export function ShowArchivedToggle({
  includeArchived,
}: {
  includeArchived: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleToggle(next: boolean) {
    const params = new URLSearchParams(searchParams);
    if (next) {
      params.set("archived", "1");
    } else {
      params.delete("archived");
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        id="show-archived"
        checked={includeArchived}
        onCheckedChange={handleToggle}
      />
      <Label htmlFor="show-archived" className="text-xs cursor-pointer">
        Show archived
      </Label>
    </div>
  );
}
