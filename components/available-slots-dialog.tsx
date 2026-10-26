"use client"

import { useState, useEffect } from "react"
import { addDays, format } from "date-fns"
import { Clock, Calendar, CheckCircle, AlertCircle, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { getBookingsForDateRange, getUserFoodTruck, getBookingRules, createBooking, getSpaceBlockedDates } from "@/app/actions"
import { useToast } from "@/components/ui/use-toast"
import { findSlotBlock, slotTypeFromStart } from "@/lib/booking-rules"

interface AvailableSlotsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  spaceId: string
  spaceName: string
  timeSlots: any[]
}

export function AvailableSlotsDialog({
  open,
  onOpenChange,
  spaceId,
  spaceName,
  timeSlots
}: AvailableSlotsDialogProps) {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [bookings, setBookings] = useState<any[]>([])
  const [blockedDates, setBlockedDates] = useState<any[]>([])
  const [slots, setSlots] = useState<any[]>([])
  const [userFoodTruck, setUserFoodTruck] = useState<any>(null)
  const [bookingRules, setBookingRules] = useState<any>(null)
  const [futureBookings, setFutureBookings] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState<any>(null)
  const [isBooking, setIsBooking] = useState(false)
  const [error, setError] = useState("")

  // Load user food truck and booking rules
  useEffect(() => {
    const loadUserData = async () => {
      try {
        const [foodTruckResult, rulesResult] = await Promise.all([
          getUserFoodTruck(),
          getBookingRules()
        ])

        if (foodTruckResult.success && foodTruckResult.data) {
          setUserFoodTruck(foodTruckResult.data)
          
          // Count future bookings
          if (foodTruckResult.data.bookings) {
            const now = new Date()
            const future = foodTruckResult.data.bookings.filter(
              (booking: any) => new Date(booking.start) > now
            )
            setFutureBookings(future.length)
          }
        }

        if (rulesResult.success && rulesResult.data) {
          setBookingRules(rulesResult.data)
        }
      } catch (err) {
        console.error("Error loading user data:", err)
        setError("Failed to load user data")
      }
    }

    if (open) {
      loadUserData()
      loadAvailableSlots()
    }
  }, [open])

  // Generate available time slots for the next X days
  const loadAvailableSlots = async () => {
    setIsLoading(true)
    setError("")
    
    try {
      // Get max days ahead from rules, or default to 14 days
      let maxDaysAhead = 14
      
      // Get booking rules if needed
      if (!bookingRules) {
        const rulesResult = await getBookingRules()
        if (rulesResult.success && rulesResult.data) {
          maxDaysAhead = rulesResult.data.maximum_days_ahead
          setBookingRules(rulesResult.data)
        }
      } else {
        maxDaysAhead = bookingRules.maximum_days_ahead
      }
      
      // Generate dates for the next X days
      const dates = []
      const now = new Date()
      
      for (let i = 0; i < maxDaysAhead; i++) {
        dates.push(addDays(now, i))
      }
      
      // Get all bookings and blocked dates for this date range
      const startDate = new Date()
      startDate.setHours(0, 0, 0, 0)

      const endDate = addDays(startDate, maxDaysAhead)
      endDate.setHours(23, 59, 59, 999)

      const [bookingsResult, blockedResult] = await Promise.all([
        getBookingsForDateRange(startDate.toISOString(), endDate.toISOString()),
        getSpaceBlockedDates()
      ])

      if (bookingsResult.success) {
        // Filter to only bookings for this space
        const spaceBookings = bookingsResult.data?.filter(
          (booking: any) => booking.space.id === spaceId
        ) || []

        setBookings(spaceBookings)

        // Filter blocked dates for this space
        const spaceBlockedDates = blockedResult.success
          ? (blockedResult.data || []).filter((blocked: any) =>
              blocked.space?.id === spaceId || blocked.space === parseInt(spaceId)
            )
          : []

        setBlockedDates(spaceBlockedDates)

        // Generate all possible slots
        const allSlots = dates.flatMap(date =>
          timeSlots.map(slot => ({
            date,
            timeSlot: slot,
            isAvailable: !isSlotBooked(spaceId, slot, date, spaceBookings) &&
                        !isSlotBlocked(slot, date, spaceBlockedDates)
          }))
        )

        // Only show available slots
        setSlots(allSlots.filter(slot => slot.isAvailable))
      } else {
        setError("Failed to load bookings")
      }
    } catch (err) {
      console.error("Error loading slots:", err)
      setError("Failed to load available slots")
    } finally {
      setIsLoading(false)
    }
  }
  
  // Check if a slot is already booked
  const isSlotBooked = (spaceId: string, timeSlot: any, date: Date, bookingsList: any[]): boolean => {
    // Parse time slot start/end
    const dateStr = format(date, 'yyyy-MM-dd')
    const timeSlotStart = new Date(`${dateStr}T${timeSlot.start}:00`)
    const timeSlotEnd = new Date(`${dateStr}T${timeSlot.end}:00`)

    // Check if any booking overlaps with this slot
    return bookingsList.some(booking => {
      try {
        // Skip if not for this space
        if (booking.space.id !== spaceId) return false

        const bookingStart = new Date(booking.start)
        const bookingEnd = new Date(booking.end)

        return (bookingStart <= timeSlotEnd && bookingEnd >= timeSlotStart)
      } catch (error) {
        console.error("Error checking booking overlap:", error)
        return false
      }
    })
  }

  // Check if a slot is blocked by admin (shared rule, lib/booking-rules.ts).
  // blockedList is already filtered to this space.
  const isSlotBlocked = (timeSlot: any, date: Date, blockedList: any[]): boolean => {
    if (!timeSlot?.start) return false
    return findSlotBlock(blockedList, spaceId, format(date, 'yyyy-MM-dd'), slotTypeFromStart(timeSlot.start)).blocked
  }
  
  // Check if user has reached max bookings
  const hasReachedMaxBookings = (): boolean => {
    if (!bookingRules) return false
    return futureBookings >= bookingRules.maximum_future_bookings
  }
  
  // Check if a booking is within the last-minute booking window
  const isLastMinuteBooking = (startDate: Date): boolean => {
    if (!bookingRules) return false
    
    const now = new Date()
    const hoursUntilBooking = (startDate.getTime() - now.getTime()) / (1000 * 60 * 60)
    
    return hoursUntilBooking <= bookingRules.last_minute_booking_hours
  }
  
  // Handle booking a slot
  const handleBookSlot = async (slot: any) => {
    if (!userFoodTruck) {
      toast({
        title: "Food truck not found",
        description: "You need a registered food truck to make bookings",
        variant: "destructive"
      })
      return
    }
    
    // If user is at max bookings, check if this is a last-minute booking
    if (hasReachedMaxBookings()) {
      // If it's not a last-minute booking, don't allow it
      if (!isLastMinuteBooking(slot.date)) {
        toast({
          title: "Maximum bookings reached",
          description: `You already have ${bookingRules?.maximum_future_bookings} future bookings. You can only make last-minute bookings within ${bookingRules?.last_minute_booking_hours} hours.`,
          variant: "destructive"
        })
        return
      }
    }
    
    setSelectedSlot(slot)
  }
  
  // Confirm booking
  const confirmBooking = async () => {
    if (!userFoodTruck || !selectedSlot) {
      toast({
        title: "Error",
        description: "Missing required information for booking",
        variant: "destructive"
      })
      return
    }
    
    setIsBooking(true)
    
    try {
      // Format date and times
      const dateStr = format(selectedSlot.date, 'yyyy-MM-dd')
      const startTime = `${dateStr}T${selectedSlot.timeSlot.start}:00`
      const endTime = `${dateStr}T${selectedSlot.timeSlot.end}:00`
      
      // Create booking
      const bookingData = {
        foodtruck: userFoodTruck.id,
        space: spaceId,
        start: startTime,
        end: endTime
      }
      
      const result = await createBooking(bookingData)
      
      if (result.success) {
        toast({
          title: "Booking confirmed",
          description: `Your booking for ${spaceName} on ${format(selectedSlot.date, 'MMMM d, yyyy')} at ${selectedSlot.timeSlot.start} has been confirmed.`,
          variant: "default"
        })
        
        // Close dialog
        onOpenChange(false)
      } else {
        toast({
          title: "Booking failed",
          description: result.error || "Failed to create booking",
          variant: "destructive"
        })
      }
    } catch (err) {
      console.error("Error creating booking:", err)
      toast({
        title: "Booking error",
        description: err instanceof Error ? err.message : "An error occurred",
        variant: "destructive"
      })
    } finally {
      setIsBooking(false)
      setSelectedSlot(null)
    }
  }
  
  // Cancel booking
  const cancelBooking = () => {
    setSelectedSlot(null)
  }
  
  // Group slots by date
  const groupedSlots = slots.reduce((groups: any, slot) => {
    const dateStr = format(slot.date, 'yyyy-MM-dd')
    if (!groups[dateStr]) {
      groups[dateStr] = []
    }
    groups[dateStr].push(slot)
    return groups
  }, {})
  
  // Generate a list of dates
  const datesList = Object.keys(groupedSlots).sort()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md md:max-w-lg lg:max-w-xl">
        <DialogHeader>
          <DialogTitle>Available Booking Slots for {spaceName}</DialogTitle>
          <DialogDescription>
            Select from available time slots for this space
          </DialogDescription>
        </DialogHeader>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-md">
            {error}
          </div>
        )}
        
        {bookingRules && (
          <div className="flex gap-2 items-center text-sm text-muted-foreground mb-4">
            <div className={`${hasReachedMaxBookings() ? 'text-amber-600' : 'text-green-600'} flex items-center gap-1`}>
              {hasReachedMaxBookings() ? (
                <AlertCircle className="h-4 w-4" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              <span>{futureBookings}/{bookingRules.maximum_future_bookings} future bookings used</span>
            </div>
            
            {hasReachedMaxBookings() && (
              <div className="text-xs">
                <span className="text-amber-700">Only last-minute bookings available (within {bookingRules.last_minute_booking_hours} hours)</span>
              </div>
            )}
          </div>
        )}
        
        {selectedSlot ? (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Confirm Booking</h3>
            <div className="bg-muted p-4 rounded-md">
              <div className="font-medium">{spaceName}</div>
              <div className="text-sm text-muted-foreground mt-1">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {format(selectedSlot.date, 'EEEE, MMMM d, yyyy')}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Clock className="h-4 w-4" />
                  {selectedSlot.timeSlot.start} - {selectedSlot.timeSlot.end}
                </div>
              </div>
            </div>
            
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                disabled={isBooking}
                onClick={cancelBooking}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isBooking}
                onClick={confirmBooking}
              >
                {isBooking ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-b-transparent"></div>
                    Booking...
                  </>
                ) : (
                  "Confirm Booking"
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : isLoading ? (
          <div className="py-8 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : slots.length === 0 ? (
          <div className="py-8 text-center">
            <Clock className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-2 text-lg font-medium">No Available Slots</h3>
            <p className="text-muted-foreground">
              There are no available booking slots for this space at this time.
            </p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto pr-2">
            {datesList.map(dateStr => (
              <div key={dateStr} className="mb-4">
                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(dateStr), 'EEEE, MMMM d, yyyy')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {groupedSlots[dateStr].map((slot: any, index: number) => (
                    <Button
                      key={`${dateStr}-${index}`}
                      variant="outline"
                      className="justify-start h-auto py-2"
                      onClick={() => handleBookSlot(slot)}
                    >
                      <Clock className="mr-2 h-4 w-4" />
                      <span className="text-sm">
                        {slot.timeSlot.description} ({slot.timeSlot.start} - {slot.timeSlot.end})
                      </span>
                    </Button>
                  ))}
                </div>
                {dateStr !== datesList[datesList.length - 1] && (
                  <Separator className="my-3" />
                )}
              </div>
            ))}
          </div>
        )}
        
        {!selectedSlot && !isLoading && slots.length > 0 && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              <X className="mr-2 h-4 w-4" />
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}