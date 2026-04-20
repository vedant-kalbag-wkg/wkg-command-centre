"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchThresholds, saveThresholds } from "./actions";

export default function ThresholdsPage() {
  const [redMax, setRedMax] = React.useState(500);
  const [greenMin, setGreenMin] = React.useState(1500);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  React.useEffect(() => {
    fetchThresholds()
      .then((config) => {
        setRedMax(config.redMax);
        setGreenMin(config.greenMin);
      })
      .catch(() => {
        // Keep defaults on error
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    const result = await saveThresholds({ redMax, greenMin });

    if ("error" in result) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: "Thresholds saved successfully" });
    }
    setSaving(false);
  };

  const amberLow = redMax + 1;
  const amberHigh = greenMin - 1;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Performance Thresholds"
        description="Configure traffic-light thresholds used to color-code revenue performance across locations."
        actions={
          <Link href="/settings">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <ArrowLeft className="size-4" />
              Back to Settings
            </Button>
          </Link>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Revenue Thresholds</CardTitle>
              <CardDescription>
                Configure traffic-light thresholds to color-code locations based on
                revenue performance. Values are in currency units.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {loading ? (
                <div className="animate-pulse space-y-4">
                  <div className="h-10 rounded bg-muted" />
                  <div className="h-10 rounded bg-muted" />
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="redMax">
                        Red Max
                        <span className="ml-1 text-xs text-muted-foreground">
                          (revenue at or below = red)
                        </span>
                      </Label>
                      <Input
                        id="redMax"
                        type="number"
                        min={0}
                        value={redMax}
                        onChange={(e) =>
                          setRedMax(Number(e.target.value))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="greenMin">
                        Green Min
                        <span className="ml-1 text-xs text-muted-foreground">
                          (revenue at or above = green)
                        </span>
                      </Label>
                      <Input
                        id="greenMin"
                        type="number"
                        min={0}
                        value={greenMin}
                        onChange={(e) =>
                          setGreenMin(Number(e.target.value))
                        }
                      />
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="rounded-lg border bg-muted/50 p-4">
                    <p className="mb-2 text-sm font-medium">Preview</p>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
                        Red: &le;{redMax.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground">|</span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-3 w-3 rounded-full bg-amber-500" />
                        Amber: {amberLow.toLocaleString()}&ndash;{amberHigh.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground">|</span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
                        Green: &ge;{greenMin.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {message && (
                    <div
                      className={`rounded-lg border px-4 py-3 text-sm ${
                        message.type === "error"
                          ? "border-destructive/50 bg-destructive/10 text-destructive"
                          : "border-green-200 bg-green-50 text-green-700"
                      }`}
                    >
                      {message.text}
                    </div>
                  )}

                  <Button onClick={handleSave} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Saving..." : "Save Thresholds"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
