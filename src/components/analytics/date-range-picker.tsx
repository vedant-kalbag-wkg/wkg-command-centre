"use client"

import { useState } from "react"
import { CalendarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { formatDate } from "@/lib/analytics/formatters"
import { getPresetRange } from "@/lib/stores/analytics-filter-store"
import type { DatePreset } from "@/lib/analytics/types"
import type { DateRange } from "react-day-picker"

interface DateRangePickerProps {
  from: Date
  to: Date
  onRangeChange: (from: Date, to: Date) => void
}

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: "This Month", value: "this-month" },
  { label: "Last Month", value: "last-month" },
  { label: "Last 3 Months", value: "last-3-months" },
  { label: "This Quarter", value: "this-quarter" },
  { label: "Last Quarter", value: "last-quarter" },
  { label: "YTD", value: "ytd" },
  { label: "Last Year", value: "last-year" },
]

export function DateRangePicker({
  from,
  to,
  onRangeChange,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>({ from, to })

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft({ from, to })
    }
    setOpen(next)
  }

  function applyPreset(preset: DatePreset) {
    const range = getPresetRange(preset)
    setDraft({ from: range.from, to: range.to })
  }

  function handleApply() {
    if (draft.from && draft.to) {
      onRangeChange(draft.from, draft.to)
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 gap-1.5" />
        }
      >
        <CalendarIcon className="size-3.5 opacity-50" />
        <span className="text-xs">
          {formatDate(from)} &ndash; {formatDate(to)}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex flex-wrap gap-1 pb-3">
          {PRESETS.map((preset) => (
            <Button
              key={preset.value}
              variant="outline"
              size="xs"
              onClick={() => applyPreset(preset.value)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={draft}
          onSelect={(range) => {
            if (range) setDraft(range)
          }}
          numberOfMonths={2}
        />
        <div className="flex justify-end pt-3">
          <Button
            size="sm"
            onClick={handleApply}
            disabled={!draft.from || !draft.to}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
