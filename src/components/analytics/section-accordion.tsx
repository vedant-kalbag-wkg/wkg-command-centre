"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"

interface SectionAccordionProps {
  title: string
  defaultOpen?: boolean
  actions?: React.ReactNode
  children: React.ReactNode
}

export function SectionAccordion({
  title,
  defaultOpen = true,
  actions,
  children,
}: SectionAccordionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border rounded-lg overflow-hidden">
        <CollapsibleTrigger
          className="w-full flex items-center justify-between px-4 py-3 bg-background hover:bg-muted/50 transition-colors text-left rounded-t-lg"
        >
          <span className="font-semibold text-sm">{title}</span>
          <div className="flex items-center gap-2">
            {actions && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="flex items-center"
              >
                {actions}
              </div>
            )}
            <ChevronDown
              className="size-4 text-muted-foreground transition-transform duration-200"
              style={{
                transform: open ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 py-4">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
