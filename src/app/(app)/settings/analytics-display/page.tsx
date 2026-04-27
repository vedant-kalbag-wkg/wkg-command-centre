"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchAnalyticsDisplayTimezone,
  saveAnalyticsDisplayTimezone,
} from "./actions";
import type { AnalyticsDisplayTimezone } from "@/lib/analytics/display-timezone-server";

export default function AnalyticsDisplayTimezonePage() {
  const [value, setValue] = React.useState<AnalyticsDisplayTimezone>("local");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  React.useEffect(() => {
    fetchAnalyticsDisplayTimezone()
      .then(setValue)
      .catch(() => {
        // Keep default on error
      })
      .finally(() => setLoading(false));
  }, []);

  const handleChange = async (next: AnalyticsDisplayTimezone) => {
    setSaving(true);
    setMessage(null);
    setValue(next);

    const result = await saveAnalyticsDisplayTimezone(next);

    if ("error" in result) {
      setMessage({ type: "error", text: result.error });
    } else {
      setMessage({ type: "success", text: "Display timezone updated" });
    }
    setSaving(false);
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Analytics Display Timezone"
        description="Choose whether hour-of-day analytics bucket sales by each location's local time or by UTC."
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
              <CardTitle>Hour-of-day display mode</CardTitle>
              <CardDescription>
                Affects the Hourly Distribution widget on the portfolio dashboard
                and the <code>sale_hour</code> dimension in the Pivot Table.
                Saves immediately on change.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="animate-pulse">
                  <div className="h-10 rounded bg-muted" />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="display-tz">Display timezone</Label>
                    <Select
                      value={value}
                      onValueChange={(v) =>
                        handleChange(v as AnalyticsDisplayTimezone)
                      }
                      disabled={saving}
                    >
                      <SelectTrigger id="display-tz" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">
                          Local (per location)
                        </SelectItem>
                        <SelectItem value="utc">UTC</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      <strong>Local</strong> uses each location&apos;s configured
                      IANA timezone, so 6&nbsp;PM in Sydney and 6&nbsp;PM in
                      London both bucket into &ldquo;18&rdquo;. <strong>UTC</strong>{" "}
                      buckets every sale by its raw UTC hour — useful for
                      debugging the source feed.
                    </p>
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
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
