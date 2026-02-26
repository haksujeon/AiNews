"use client";

import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/lib/utils";

type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, ...props }: CalendarProps) {
  return (
    <DayPicker
      className={cn("p-3", className)}
      style={
        {
          "--rdp-accent-color": "hsl(var(--primary))",
          "--rdp-accent-background-color": "hsl(var(--primary) / 0.1)",
          "--rdp-range_middle-background-color": "hsl(var(--primary) / 0.08)",
          "--rdp-day_button-height": "32px",
          "--rdp-day_button-width": "32px",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Calendar };
