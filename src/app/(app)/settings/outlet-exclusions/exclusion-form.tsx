"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { testPattern, type RegionOption } from "./actions";

interface ExclusionFormProps {
  regions: RegionOption[];
  onSubmit: (data: {
    outletCode: string;
    patternType: "exact" | "regex";
    regionId: string;
    label?: string;
  }) => Promise<void>;
}

export function ExclusionForm({ regions, onSubmit }: ExclusionFormProps) {
  const [pattern, setPattern] = React.useState("");
  const [patternType, setPatternType] = React.useState<"exact" | "regex">("exact");
  const [regionId, setRegionId] = React.useState<string>("");
  const [label, setLabel] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResults, setTestResults] = React.useState<string[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleTest = async () => {
    if (!pattern.trim()) {
      setError("Enter a pattern to test");
      return;
    }
    if (!regionId) {
      setError("Select a region to test against");
      return;
    }
    setTesting(true);
    setError(null);
    setTestResults(null);
    const result = await testPattern(pattern.trim(), patternType, regionId);
    if ("error" in result) {
      setError(result.error);
    } else {
      setTestResults(result.matches);
    }
    setTesting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) {
      setError("Pattern is required");
      return;
    }
    if (!regionId) {
      setError("Region is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        outletCode: pattern.trim(),
        patternType,
        regionId,
        label: label.trim() || undefined,
      });
      setPattern("");
      setLabel("");
      setRegionId("");
      setTestResults(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-medium">Add Exclusion Rule</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="excl-region">Region</Label>
          <Select value={regionId} onValueChange={(v) => v && setRegionId(v)}>
            <SelectTrigger className="w-full" id="excl-region">
              <SelectValue placeholder="Select region…" />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="excl-type">Pattern Type</Label>
          <Select
            value={patternType}
            onValueChange={(v) => v && setPatternType(v as "exact" | "regex")}
          >
            <SelectTrigger className="w-full" id="excl-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exact">Exact</SelectItem>
              <SelectItem value="regex">Regex</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="excl-pattern">
            {patternType === "exact" ? "Outlet Code" : "Regex Pattern"}
          </Label>
          <Input
            id="excl-pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={
              patternType === "exact" ? "e.g. OUTLET001" : "e.g. ^TEST.*"
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="excl-label">Label (optional)</Label>
          <Input
            id="excl-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Test outlets"
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {testResults !== null && (
        <div className="rounded-md bg-muted p-3 space-y-2">
          <p className="text-sm font-medium">
            {testResults.length} outlet{testResults.length !== 1 ? "s" : ""} matched
          </p>
          {testResults.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {testResults.slice(0, 50).map((code) => (
                <Badge key={code} variant="outline" className="font-mono text-xs">
                  {code}
                </Badge>
              ))}
              {testResults.length > 50 && (
                <Badge variant="secondary" className="text-xs">
                  +{testResults.length - 50} more
                </Badge>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing}
        >
          {testing ? "Testing..." : "Test Pattern"}
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Adding..." : "Add Exclusion"}
        </Button>
      </div>
    </form>
  );
}
