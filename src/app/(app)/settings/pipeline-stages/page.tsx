import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { listPipelineStages } from "@/app/(app)/kiosks/actions";
import { PipelineStagesClient } from "./pipeline-stages-client";

export default async function PipelineStagesPage() {
  const stages = await listPipelineStages();

  return (
    <AppShell
      title="Pipeline Stages"
      action={
        <Link href="/settings/users">
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Settings
          </Button>
        </Link>
      }
    >
      <PipelineStagesClient stages={stages} />
    </AppShell>
  );
}
