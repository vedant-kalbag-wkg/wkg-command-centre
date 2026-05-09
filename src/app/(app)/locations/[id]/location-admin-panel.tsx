"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { silenceLocation, unsilenceLocation } from "./silence-actions";

interface LocationAdminPanelProps {
  locationId: string;
  isSilenced: boolean;
  currentReason: string | null;
}

export function LocationAdminPanel({
  locationId,
  isSilenced,
  currentReason,
}: LocationAdminPanelProps) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const handleSilence = () => {
    startTransition(async () => {
      const result = await silenceLocation(locationId, reason);
      if (result.ok) {
        toast.success("Hotel alerts silenced");
        setReason("");
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleUnsilence = () => {
    startTransition(async () => {
      const result = await unsilenceLocation(locationId, reason.trim() || undefined);
      if (result.ok) {
        toast.success("Hotel alerts unsilenced");
        setReason("");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert silencing (admin only)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isSilenced ? (
          <>
            <div
              className="rounded-md p-3 text-sm"
              style={{ borderLeft: "4px solid #00A6D3", backgroundColor: "#CCEDF6" }}
            >
              <p className="font-medium text-gray-800">Alerts are currently silenced</p>
              {currentReason && (
                <p className="mt-1 text-gray-700">{currentReason}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="unsilence-reason">Reason for unsilencing (optional)</Label>
              <Textarea
                id="unsilence-reason"
                placeholder="Briefly describe why you are re-enabling alerts…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>
            <Button
              onClick={handleUnsilence}
              disabled={pending}
              className="max-w-sm"
            >
              {pending ? "Unsilencing…" : "Unsilence alerts"}
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="silence-reason">Reason for silencing</Label>
              <Textarea
                id="silence-reason"
                placeholder="Describe why performance alerts should be suppressed for this hotel…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>
            <Button
              onClick={handleSilence}
              disabled={pending || reason.trim().length < 3}
              variant="destructive"
              className="max-w-sm"
            >
              {pending ? "Silencing…" : "Silence alerts"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
