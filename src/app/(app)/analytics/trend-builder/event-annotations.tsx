"use client";

import { ReferenceLine, ReferenceArea } from "recharts";
import type { BusinessEventDisplay } from "@/lib/analytics/types";

interface EventAnnotationsProps {
  events: BusinessEventDisplay[];
  activeCategories: string[];
}

/**
 * Renders ReferenceLine (point events) and ReferenceArea (range events)
 * as overlays on the main trend chart. Must be rendered inside a Recharts
 * chart component (LineChart/BarChart).
 */
export function EventAnnotations({
  events,
  activeCategories,
}: EventAnnotationsProps) {
  const filtered = events.filter((e) =>
    activeCategories.includes(e.categoryName),
  );

  return (
    <>
      {filtered.map((event) => {
        if (event.endDate) {
          // Range event
          return (
            <ReferenceArea
              key={event.id}
              x1={event.startDate}
              x2={event.endDate}
              fill={event.categoryColor}
              fillOpacity={0.08}
              stroke={event.categoryColor}
              strokeOpacity={0.3}
              strokeDasharray="3 3"
              label={{
                value: event.title,
                position: "insideTopLeft",
                fontSize: 10,
                fill: event.categoryColor,
              }}
            />
          );
        }

        // Point event
        return (
          <ReferenceLine
            key={event.id}
            x={event.startDate}
            stroke={event.categoryColor}
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={{
              value: event.title,
              position: "insideTopRight",
              fontSize: 10,
              fill: event.categoryColor,
              angle: -90,
            }}
          />
        );
      })}
    </>
  );
}
