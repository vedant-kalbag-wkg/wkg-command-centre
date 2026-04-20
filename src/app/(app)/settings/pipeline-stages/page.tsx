import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { listPipelineStages } from "@/app/(app)/kiosks/actions";
import { PipelineStagesClient } from "./pipeline-stages-client";

export default async function PipelineStagesPage() {
  const stages = await listPipelineStages();

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Pipeline Stages"
        description="Manage the stages used to track kiosks through the deployment pipeline."
        count={stages.length}
        actions={
          <Link href="/settings/users">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <ArrowLeft className="size-4" />
              Back to Settings
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <PipelineStagesClient stages={stages} />
      </div>
    </div>
  );
}
