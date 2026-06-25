"use client"

import { useMemo, useState } from "react"
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  eachWeekOfInterval,
  getISOWeek,
  isSameMonth,
  isSameDay,
  isBefore,
  startOfDay,
  format,
} from "date-fns"
import { sv } from "date-fns/locale"
import { ChevronLeft, ChevronRight, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const WEEKDAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"]

export interface CalendarBooking {
  foodtruck: string
  space: string
}

interface MultiDateCalendarProps {
  /** Selected dates as "yyyy-MM-dd" strings */
  selected: string[]
  onToggle: (date: string) => void
  /** Dates that are already blocked (shown but not selectable) as "yyyy-MM-dd" */
  disabledDates?: string[]
  /** Existing bookings keyed by "yyyy-MM-dd" */
  bookingsByDate?: Record<string, CalendarBooking[]>
}

export function MultiDateCalendar({
  selected,
  onToggle,
  disabledDates = [],
  bookingsByDate = {},
}: MultiDateCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()))
  const today = startOfDay(new Date())

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const disabledSet = useMemo(() => new Set(disabledDates), [disabledDates])

  // Build week rows (Mon–Sun) covering the whole month.
  const weeks = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(monthStart)
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

    return eachWeekOfInterval({ start: calStart, end: calEnd }, { weekStartsOn: 1 }).map((weekStart) => ({
      weekNumber: getISOWeek(weekStart),
      days: eachDayOfInterval({
        start: weekStart,
        end: endOfWeek(weekStart, { weekStartsOn: 1 }),
      }),
    }))
  }, [currentMonth])

  return (
    <TooltipProvider delayDuration={100}>
      <div className="w-full select-none">
        {/* Month header */}
        <div className="flex items-center justify-between mb-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-base font-semibold capitalize">
            {format(currentMonth, "MMMM yyyy", { locale: sv })}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Column headers: week-number col + Mon–Sun */}
        <div className="grid grid-cols-[2.25rem_repeat(7,1fr)] gap-1 mb-1">
          <div className="text-[0.65rem] font-semibold text-muted-foreground flex items-end justify-center pb-1">
            v.
          </div>
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-xs font-semibold text-muted-foreground text-center py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Week rows */}
        <div className="space-y-1">
          {weeks.map((week) => (
            <div
              key={week.weekNumber + "-" + format(week.days[0], "yyyy-MM-dd")}
              className="grid grid-cols-[2.25rem_repeat(7,1fr)] gap-1"
            >
              <div className="flex items-center justify-center text-[0.7rem] text-muted-foreground font-semibold">
                {week.weekNumber}
              </div>
              {week.days.map((day) => {
                const key = format(day, "yyyy-MM-dd")
                const inMonth = isSameMonth(day, currentMonth)
                const isPast = isBefore(day, today)
                const isToday = isSameDay(day, today)
                const isSelected = selectedSet.has(key)
                const isBlocked = disabledSet.has(key)
                const dayBookings = bookingsByDate[key]
                const hasBookings = !!dayBookings && dayBookings.length > 0
                const disabled = isPast || isBlocked

                const cell = (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onToggle(key)}
                    className={cn(
                      "relative h-9 w-full rounded-md text-sm flex items-center justify-center",
                      "transition-all duration-100 active:scale-90",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      // base in-month, enabled
                      inMonth && !disabled && "text-foreground font-medium hover:bg-accent hover:scale-105",
                      // out of month
                      !inMonth && "text-muted-foreground/30",
                      // today marker
                      isToday && !isSelected && "ring-2 ring-primary/60",
                      // has bookings (not selected)
                      hasBookings && !isSelected && !disabled &&
                        "bg-amber-100 text-amber-950 ring-1 ring-amber-400 hover:bg-amber-200",
                      // selected — strong, obvious feedback
                      isSelected &&
                        "bg-primary text-primary-foreground font-bold scale-105 shadow-md ring-2 ring-primary ring-offset-1 hover:bg-primary",
                      // already blocked
                      isBlocked && "bg-muted text-muted-foreground line-through cursor-not-allowed",
                      // past
                      isPast && !isBlocked && "text-muted-foreground/30 cursor-not-allowed",
                    )}
                  >
                    {isSelected ? (
                      <span className="relative flex items-center justify-center">
                        <Check className="h-4 w-4" strokeWidth={3} />
                      </span>
                    ) : (
                      format(day, "d")
                    )}
                    {/* booking dot indicator (also shows on selected days) */}
                    {hasBookings && (
                      <span
                        className={cn(
                          "absolute bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full",
                          isSelected ? "bg-amber-300" : "bg-amber-500",
                        )}
                      />
                    )}
                  </button>
                )

                if (hasBookings) {
                  return (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>{cell}</TooltipTrigger>
                      <TooltipContent className="max-w-[16rem]">
                        <div className="font-semibold mb-1">
                          {format(day, "d MMMM", { locale: sv })} — {dayBookings!.length} bokning
                          {dayBookings!.length === 1 ? "" : "ar"}
                        </div>
                        <ul className="space-y-0.5">
                          {dayBookings!.map((b, i) => (
                            <li key={i}>
                              <span className="font-medium">{b.foodtruck}</span>
                              <span className="opacity-80"> @ {b.space}</span>
                            </li>
                          ))}
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                  )
                }

                return <div key={key}>{cell}</div>
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-amber-100 ring-1 ring-amber-400 inline-block" />
            Befintlig bokning
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-primary inline-block" />
            Vald att spärra
          </span>
        </div>
      </div>
    </TooltipProvider>
  )
}
