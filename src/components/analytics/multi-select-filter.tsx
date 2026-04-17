"use client"

import { useState, useMemo } from "react"
import { ChevronsUpDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"

interface MultiSelectFilterProps {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  placeholder = "Search...",
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const filteredOptions = useMemo(() => {
    if (!search) return options
    const lower = search.toLowerCase()
    return options.filter((opt) => opt.label.toLowerCase().includes(lower))
  }, [options, search])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  function toggleOption(value: string) {
    if (selectedSet.has(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  function selectAllVisible() {
    const visibleValues = filteredOptions.map((o) => o.value)
    const merged = new Set([...selected, ...visibleValues])
    onChange(Array.from(merged))
  }

  function clearAll() {
    onChange([])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 gap-1.5" />
        }
      >
        {label}
        {selected.length > 0 && (
          <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
            {selected.length}
          </Badge>
        )}
        <ChevronsUpDown className="ml-1 size-3.5 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={search}
            onValueChange={setSearch}
          />
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={selectAllVisible}
            >
              Select All
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={clearAll}
            >
              Clear
            </Button>
          </div>
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => {
                const isSelected = selectedSet.has(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => toggleOption(option.value)}
                  >
                    <div
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input",
                        isSelected && "border-primary bg-primary text-primary-foreground"
                      )}
                    >
                      {isSelected && <Check className="size-3" />}
                    </div>
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
