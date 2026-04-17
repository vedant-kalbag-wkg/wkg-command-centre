"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
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
      <div className="flex items-center justify-between border-b py-2">
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium">
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-200",
              !open && "-rotate-90"
            )}
          />
          {title}
        </CollapsibleTrigger>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      <CollapsibleContent>
        <div className="pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
