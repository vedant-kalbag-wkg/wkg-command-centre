"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ManageStagesModal } from "@/components/pipeline/manage-stages-modal";

type PipelineStage = {
  id: string;
  name: string;
  position: number;
  color: string | null;
  isDefault: boolean;
};

interface PipelineStagesClientProps {
  stages: PipelineStage[];
}

export function PipelineStagesClient({ stages }: PipelineStagesClientProps) {
  const router = useRouter();

  const handleStagesChange = () => {
    router.refresh();
  };

  return (
    <ManageStagesModal
      open={true}
      onOpenChange={() => {
        // On close, navigate back to settings
        router.push("/settings/users");
      }}
      stages={stages}
      onStagesChange={handleStagesChange}
    />
  );
}
