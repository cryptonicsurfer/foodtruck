"use client"

import { useState, useEffect } from "react"
import { format, addDays } from "date-fns"
import { useRouter } from "next/navigation"
import { ProtectedRoute } from "@/components/protected-route"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Soup, Calendar as CalendarIcon, MapPin, User, Check, AlertCircle, X, PanelLeftIcon, Clock, CircleCheck, Menu, Ban } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/lib/auth-context"
import {
  getAllSpaces,
  getBookingsForDateRange,
  getUserFoodTruck,
  createBooking,
  getBookingRules,
  getFoodTruckBookings,
  getSpaceBlockedDates
} from "@/app/actions"
import { BookingRules } from "@/components/booking-rules"

export default function BookingPage() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const today = new Date()
  const [date, setDate] = useState<Date | undefined>(today)
  const [spaces, setSpaces] = useState<any[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [userFoodTruck, setUserFoodTruck] = useState<any>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [isBooking, setIsBooking] = useState(false)
  const [bookingSpace, setBookingSpace] = useState<any>(null)
  const [bookingTimeSlot, setBookingTimeSlot] = useState<any>(null)
  const [showBookingConfirm, setShowBookingConfirm] = useState(false)
  const [bookingRules, setBookingRules] = useState<null | {
    maximum_future_bookings: number;
    maximum_days_ahead: number;
    last_minute_booking_hours: number;
  }>(null)
  const [futureBookings, setFutureBookings] = useState(0)
  const [loadingRules, setLoadingRules] = useState(true)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [blockedDates, setBlockedDates] = useState<any[]>([])
  const [datesWithBlocks, setDatesWithBlocks] = useState<Date[]>([])

  // Load all blocked dates for calendar highlighting
  const loadAllBlockedDates = async () => {
    try {
      const blockedResult = await getSpaceBlockedDates()
      if (blockedResult.success && blockedResult.data) {
        setBlockedDates(blockedResult.data)

        // Create array of unique dates that have any blocks
        const uniqueDates = [...new Set(blockedResult.data.map((b: any) => b.date))]
        const dateObjects = uniqueDates.map(dateStr => {
          const [year, month, day] = (dateStr as string).split('-').map(Number)
          return new Date(year, month - 1, day)
        })
        setDatesWithBlocks(dateObjects)
      }
    } catch (err) {
      console.error("Error loading blocked dates:", err)
    }
  }

  const loadBookingsForDate = async (selectedDate: Date) => {
    if (!selectedDate) return

    setIsLoading(true)
    setError("")

    try {
      // Create start and end date for the selected day
      const startDate = new Date(selectedDate)
      startDate.setHours(0, 0, 0, 0)

      const endDate = new Date(selectedDate)
      endDate.setHours(23, 59, 59, 999)

      // Convert to ISO strings for the API
      const startDateStr = startDate.toISOString()
      const endDateStr = endDate.toISOString()

      // Load spaces and blocked dates in parallel
      const [spacesResult, bookingsResult, blockedResult] = await Promise.all([
        getAllSpaces(),
        getBookingsForDateRange(startDateStr, endDateStr),
        getSpaceBlockedDates()
      ])

      if (spacesResult.success) {
        setSpaces(spacesResult.data || [])
      } else if (spacesResult.error) {
        console.error("Error loading spaces:", spacesResult.error)
        if (spacesResult.error.includes("Invalid email or password") ||
            spacesResult.error.includes("Not authenticated")) {
          setError("Authentication error. Please log in again.")
          return
        } else {
          setError(`Failed to load spaces: ${spacesResult.error}`)
          return
        }
      }

      if (bookingsResult.success) {
        setBookings(bookingsResult.data || [])
      } else if (bookingsResult.error) {
        console.error("Error loading bookings:", bookingsResult.error)
        if (bookingsResult.error.includes("Invalid email or password") ||
            bookingsResult.error.includes("Not authenticated")) {
          setError("Authentication error. Please log in again.")
        } else {
          setError(`Failed to load bookings: ${bookingsResult.error}`)
        }
      }

      // Store blocked dates
      if (blockedResult.success && blockedResult.data) {
        setBlockedDates(blockedResult.data)

        // Update dates with blocks for calendar
        const uniqueDates = [...new Set(blockedResult.data.map((b: any) => b.date))]
        const dateObjects = uniqueDates.map(dateStr => {
          const [year, month, day] = (dateStr as string).split('-').map(Number)
          return new Date(year, month - 1, day)
        })
        setDatesWithBlocks(dateObjects)
      }
    } catch (err) {
      console.error("Error loading booking data:", err)
      if (err instanceof Error &&
          (err.message.includes("Invalid email or password") ||
           err.message.includes("Not authenticated"))) {
        setError("Authentication error. Please log in again.")
      } else {
        setError("Failed to load booking data")
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Load booking rules and check future bookings count
  const loadBookingRulesAndFutureBookings = async (foodTruckId: string) => {
    setLoadingRules(true)
    try {
      // Get booking rules
      const rulesResult = await getBookingRules()
      if (rulesResult.success && rulesResult.data) {
        setBookingRules(rulesResult.data)
      } else if (rulesResult.error) {
        console.error("Error loading booking rules:", rulesResult.error)
      }
      
      // Get future bookings
      const now = new Date()
      const bookingsResult = await getFoodTruckBookings(foodTruckId)
      if (bookingsResult.success) {
        // Count only future bookings
        const future = (bookingsResult.data || [])
          .filter((booking: any) => new Date(booking.start) > now)
        
        setFutureBookings(future.length)
      } else if (bookingsResult.error) {
        console.error("Error loading bookings:", bookingsResult.error)
      }
    } catch (err) {
      console.error("Error loading booking rules data:", err)
    } finally {
      setLoadingRules(false)
    }
  }

  // Load user's food truck
  useEffect(() => {
    async function loadUserData() {
      try {
        // Get user's food truck
        const result = await getUserFoodTruck()
        if (result.success && result.data) {
          setUserFoodTruck(result.data)
          
          // Load booking rules and future bookings
          await loadBookingRulesAndFutureBookings(result.data.id)
        } else if (result.error) {
          console.error("Error loading food truck:", result.error)
          if (result.error.includes("Invalid email or password") ||
              result.error.includes("Not authenticated")) {
            setError("Authentication error. Please log in again.")
          }
        }
      } catch (err) {
        console.error("Error loading food truck data:", err)
      } finally {
        setUserLoaded(true)
        // No foodtruck → the rules loader never runs; stop the spinner so it
        // doesn't hang on "Loading…" forever.
        setLoadingRules(false)
      }
    }

    loadUserData()
  }, [])

  // Load all blocked dates on mount for calendar indicators
  useEffect(() => {
    loadAllBlockedDates()
  }, [])

  // Load data when date changes
  useEffect(() => {
    if (date) {
      loadBookingsForDate(date)
    }
  }, [date])

  const isSpaceBooked = (spaceId: string, timeSlot: { start: string, end: string }) => {
    if (!bookings || !bookings.length) return false;
    // Guard against malformed time slots (null/missing start or end) so a single
    // bad slot in Directus can't crash the whole booking page.
    if (!timeSlot || !timeSlot.start || !timeSlot.end) return false;

    const formatTimeString = (timeStr: string) => {
      return timeStr.includes(':') ? timeStr.split(':').slice(0, 2).join(':') : timeStr;
    };

    const timeSlotStart = new Date(date || new Date());
    const formattedStart = formatTimeString(timeSlot.start);
    const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num));
    timeSlotStart.setHours(startHours, startMinutes, 0, 0);

    const timeSlotEnd = new Date(date || new Date());
    const formattedEnd = formatTimeString(timeSlot.end);
    const [endHours, endMinutes] = formattedEnd.split(':').map(num => parseInt(num));
    timeSlotEnd.setHours(endHours, endMinutes, 0, 0);
    // If end time is before start time, the slot spans midnight
    if (endHours < startHours) {
      timeSlotEnd.setDate(timeSlotEnd.getDate() + 1);
    }

    return bookings.some(booking => {
      try {
        if (!booking || !booking.start || !booking.end || !booking.space) {
          return false;
        }

        const bookingStart = new Date(booking.start);
        const bookingEnd = new Date(booking.end);
        // Handle overnight bookings where end is before start
        if (bookingEnd <= bookingStart) {
          bookingEnd.setDate(bookingEnd.getDate() + 1);
        }

        return (
          booking.space.id === spaceId &&
          (bookingStart < timeSlotEnd && bookingEnd > timeSlotStart)
        );
      } catch (error) {
        console.error("Error processing booking in isSpaceBooked:", error, booking);
        return false;
      }
    });
  };

  // Get booking details for a space and time slot
  const getBookingDetails = (spaceId: string, timeSlot: { start: string, end: string }) => {
    if (!bookings || !bookings.length) return null;
    // Guard against malformed time slots (null/missing start or end).
    if (!timeSlot || !timeSlot.start || !timeSlot.end) return null;

    const formatTimeString = (timeStr: string) => {
      return timeStr.includes(':') ? timeStr.split(':').slice(0, 2).join(':') : timeStr;
    };

    const timeSlotStart = new Date(date || new Date());
    const formattedStart = formatTimeString(timeSlot.start);
    const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num));
    timeSlotStart.setHours(startHours, startMinutes, 0, 0);

    const timeSlotEnd = new Date(date || new Date());
    const formattedEnd = formatTimeString(timeSlot.end);
    const [endHours, endMinutes] = formattedEnd.split(':').map(num => parseInt(num));
    timeSlotEnd.setHours(endHours, endMinutes, 0, 0);
    // If end time is before start time, the slot spans midnight
    if (endHours < startHours) {
      timeSlotEnd.setDate(timeSlotEnd.getDate() + 1);
    }

    return bookings.find(booking => {
      try {
        if (!booking || !booking.start || !booking.end || !booking.space) {
          return false;
        }

        const bookingStart = new Date(booking.start);
        const bookingEnd = new Date(booking.end);
        // Handle overnight bookings where end is before start
        if (bookingEnd <= bookingStart) {
          bookingEnd.setDate(bookingEnd.getDate() + 1);
        }

        return (
          booking.space.id === spaceId &&
          (bookingStart < timeSlotEnd && bookingEnd > timeSlotStart)
        );
      } catch (error) {
        console.error("Error processing booking in getBookingDetails:", error, booking);
        return false;
      }
    });
  };

  // Check if a booking is within the last-minute booking window
  const isLastMinuteBooking = (startTime: Date): boolean => {
    if (!bookingRules) return false

    const now = new Date()
    const hoursUntilBooking = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60)

    return hoursUntilBooking <= bookingRules.last_minute_booking_hours
  }

  // Check if a specific space and time slot is blocked
  const isSlotBlocked = (spaceId: string | number, timeSlot: { start: string }): { blocked: boolean; reason?: string } => {
    if (!date || !blockedDates.length) return { blocked: false }
    // Guard against malformed time slots (null/missing start).
    if (!timeSlot || !timeSlot.start) return { blocked: false }

    const dateStr = format(date, 'yyyy-MM-dd')
    const slotStartHour = parseInt(timeSlot.start.split(':')[0])
    // Morning slot is before 16:00, Evening slot is 16:00 or later
    const slotType = slotStartHour < 16 ? "morning" : "evening"

    const block = blockedDates.find(blocked => {
      // Check if this block is for the current space and date
      const blockSpaceId = blocked.space?.id || blocked.space
      if (String(blockSpaceId) !== String(spaceId)) return false
      if (blocked.date !== dateStr) return false

      // Check if the time slot matches
      if (blocked.time_slot === "all_day") return true
      if (blocked.time_slot === slotType) return true

      return false
    })

    if (block) {
      return { blocked: true, reason: block.reason }
    }
    return { blocked: false }
  }

  // Check whether the selected date falls outside a space's seasonal booking
  // window (bookable_from / bookable_to). Either bound may be null = open-ended.
  const seasonStatus = (space: any): { outside: boolean; label?: string } => {
    if (!date) return { outside: false }
    const from = space?.bookable_from ? String(space.bookable_from).slice(0, 10) : null
    const to = space?.bookable_to ? String(space.bookable_to).slice(0, 10) : null
    if (!from && !to) return { outside: false }
    const d = format(date, 'yyyy-MM-dd')
    const outside = Boolean((from && d < from) || (to && d > to))
    if (!outside) return { outside: false }
    const sv = (x: string) => x.split('-').reverse().join('/') // yyyy-MM-dd → dd/MM/yyyy
    const label = from && to
      ? `Bokningsbar ${sv(from)}–${sv(to)}`
      : from ? `Bokningsbar från ${sv(from)}` : `Bokningsbar till ${sv(to!)}`
    return { outside: true, label }
  }

  // Get count of blocked spaces for a specific date (for calendar indicator)
  const getBlockedCountForDate = (checkDate: Date): number => {
    const dateStr = format(checkDate, 'yyyy-MM-dd')
    return blockedDates.filter(b => b.date === dateStr).length
  }

  // Start the booking process
  const handleBookSpace = (space: any, timeSlot: any) => {
    console.log("=== handleBookSpace called ===", { space: space.name, timeSlot })

    if (!userFoodTruck) {
      toast({
        title: "Ingen foodtruck kopplad",
        description: "Ditt konto har ingen foodtruck. Bokning är till för foodtruck-ägare.",
        variant: "destructive"
      })
      return
    }

    // Always open the booking dialog, even if at max bookings
    // The dialog will show the appropriate status and disable the Confirm button if needed
    setBookingError(null) // Clear any previous error
    setBookingSpace(space)
    setBookingTimeSlot(timeSlot)
    setShowBookingConfirm(true)
  }
  
  // Create the actual booking
  const confirmBooking = async () => {
    console.log("=== confirmBooking called ===")

    if (!userFoodTruck || !bookingSpace || !bookingTimeSlot || !date) {
      toast({
        title: "Error",
        description: "Missing required information for booking",
        variant: "destructive"
      })
      return
    }

    setIsBooking(true)
    setBookingError(null) // Clear any previous error
    
    try {
      // Format of time_slots can be "08:00:00" or "08:00"
      const formatTimeString = (timeStr: string | null | undefined) => {
        if (!timeStr) return ''
        return timeStr.includes(':') ? timeStr.split(':').slice(0, 2).join(':') : timeStr
      }
      
      // Calculate date and time for booking in UTC
      const selectedDay = new Date(date)
      const formattedStart = formatTimeString(bookingTimeSlot.start)
      const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num))
      // Create startDate using UTC to match how the calendar component creates dates
      const startDate = new Date(Date.UTC(
        selectedDay.getFullYear(),
        selectedDay.getMonth(),
        selectedDay.getDate(),
        startHours,
        startMinutes,
        0
      ))
      
      const formattedEnd = formatTimeString(bookingTimeSlot.end)
      const [endHours, endMinutes] = formattedEnd.split(':').map(num => parseInt(num))
      // Create endDate using UTC to match how the calendar component creates dates
      const endDate = new Date(Date.UTC(
        selectedDay.getFullYear(),
        selectedDay.getMonth(),
        selectedDay.getDate(),
        endHours,
        endMinutes,
        0
      ))
      // If end time is before start time, the slot spans midnight — add one day
      if (endHours < startHours) {
        endDate.setUTCDate(endDate.getUTCDate() + 1)
      }
      
      // Create booking data
      const bookingData = {
        foodtruck: userFoodTruck.id,
        space: bookingSpace.id,
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
      
      // Call the createBooking action
      const result = await createBooking(bookingData)
      
      console.log("=== createBooking result:", JSON.stringify(result))

      if (result.success) {
        console.log("Booking SUCCESS - closing modal")
        toast({
          title: "Booking confirmed!",
          description: `You have booked ${bookingSpace.name} for ${bookingTimeSlot.description} on ${format(date, "MMMM do, yyyy")}`,
          variant: "default"
        })

        // Close the confirmation dialog and refresh the bookings
        setShowBookingConfirm(false)
        setBookingError(null)

        // Refresh the calendar view
        loadBookingsForDate(date)

        // Refresh future bookings count and rules
        if (userFoodTruck && userFoodTruck.id) {
          await loadBookingRulesAndFutureBookings(userFoodTruck.id)
        }
      } else if (result.error) {
        console.log("Booking ERROR - keeping modal open with error:", result.error)
        // Set the error to display in the modal - DO NOT close the modal
        setBookingError(result.error)
        toast({
          title: "Bokningen misslyckades",
          description: result.error,
          variant: "destructive"
        })
      }
    } catch (error) {
      console.error("Booking EXCEPTION:", error)
      const errorMsg = error instanceof Error ? error.message : "An unknown error occurred"
      setBookingError(errorMsg)
      toast({
        title: "Error",
        description: errorMsg,
        variant: "destructive"
      })
    } finally {
      setIsBooking(false)
    }
  }
  
  // Cancel the booking process (dialog)
  const cancelBooking = () => {
    setShowBookingConfirm(false)
    setBookingSpace(null)
    setBookingTimeSlot(null)
    setBookingError(null)
  }

  return (
    <ProtectedRoute>
      <SidebarProvider defaultOpen={true}>
        <div className="flex h-screen w-full relative">
          <AppSidebar />
          <div className="flex-1 p-4 md:p-6 overflow-auto w-full">
            <CustomSidebarTrigger />
            <header className="flex justify-between items-center mb-8">
              <div>
                <div className="flex items-center gap-2">
                  <Soup size={24} className="text-primary mr-2" />
                  <h1 className="text-2xl font-bold">Book a Space</h1>
                </div>
                <p className="text-muted-foreground">Select a date and book available spaces</p>
              </div>
            </header>

            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-6">
                <p className="mb-2">{error}</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => date && loadBookingsForDate(date)}
                  >
                    Try again
                  </Button>
                  {error.includes("Authentication") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        logout();
                        window.location.href = "/login";
                      }}
                    >
                      Return to login
                    </Button>
                  )}
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 min-h-[calc(100vh-10rem)] w-full">
              {/* Calendar Column - 1/3 width */}
              <div className="space-y-4">
                <Card className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <CalendarIcon className="mr-2 h-5 w-5" />
                      Select Date
                    </CardTitle>
                    <CardDescription>
                      Choose a date to see available spaces
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-start items-center pt-4">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={setDate}
                      weekStartsOn={1}
                      className=""
                      disabled={{
                        before: new Date(),
                        after: bookingRules ? addDays(new Date(), bookingRules.maximum_days_ahead) : undefined
                      }}
                      modifiers={{
                        hasBlocked: datesWithBlocks
                      }}
                      modifiersStyles={{
                        hasBlocked: {
                          position: 'relative'
                        }
                      }}
                      modifiersClassNames={{
                        hasBlocked: 'has-blocked-indicator'
                      }}
                    />
                    {datesWithBlocks.length > 0 && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="w-2 h-2 rounded-full bg-red-400"></span>
                        <span>= Plats/platser spärrade</span>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter>
                    <p className="text-sm text-muted-foreground">
                      {date ? (
                        <>Showing spaces for <strong>{format(date, "EEEE, MMMM do, yyyy")}</strong></>
                      ) : (
                        "Please select a date"
                      )}
                    </p>
                  </CardFooter>
                </Card>
                
                {/* Booking Rules */}
                <BookingRules 
                  rules={bookingRules} 
                  futureBookings={futureBookings}
                  isLoading={loadingRules}
                />
              </div>

              {/* Spaces and Timeslots Column - 2/3 width */}
              <div className="h-full flex flex-col lg:col-span-2">
                <Card className="h-full flex flex-col">
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <MapPin className="mr-2 h-5 w-5" />
                      Available Spaces
                    </CardTitle>
                    <CardDescription>
                      Spaces and time slots for {date ? format(date, "MMMM do, yyyy") : "the selected date"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-auto">
                    {userLoaded && !userFoodTruck && (
                      <div className="mb-4 flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-3">
                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                        <span>
                          Ditt konto har ingen foodtruck kopplad, så du kan inte göra bokningar här.
                          Bokning är till för foodtruck-ägare — logga in med ett foodtruck-konto för att boka.
                        </span>
                      </div>
                    )}
                    {isLoading ? (
                      <div className="flex justify-center items-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                      </div>
                    ) : spaces.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        No spaces available
                      </div>
                    ) : (
                      <div className="space-y-4 max-h-[65vh] md:max-h-full overflow-auto pr-1">
                        {spaces.map((space) => {
                          const season = seasonStatus(space)
                          return (
                          <div key={space.id} className="bg-card rounded-md shadow-sm p-4">
                            <div className="flex justify-between items-start mb-2">
                              <div className="w-full">
                                <div
                                  className="flex items-center justify-between cursor-pointer hover:text-primary transition-colors"
                                  onClick={() => router.push(`/spaces/${space.id}`)}
                                >
                                  <h3 className="font-medium">{space.name}</h3>
                                  <span className="text-xs text-primary underline">View Details</span>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {space.description ? space.description : "No description available"}
                                </p>
                              </div>
                            </div>

                            {season.outside && (
                              <div className="mt-1 flex items-center gap-1.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                <CalendarIcon size={14} className="shrink-0" />
                                <span>{season.label} — ej bokningsbar valt datum</span>
                              </div>
                            )}

                            <Separator className="my-3" />
                            
                            <div className="space-y-3">
                              <div className="grid grid-cols-1 gap-2">
                                {space.time_slots && Array.isArray(space.time_slots) && space.time_slots.length > 0 ? (
                                  space.time_slots.map((timeSlot, index) => {
                                    // Make sure the timeSlot has an id
                                    const timeSlotWithId = {
                                      ...timeSlot,
                                      id: timeSlot.id || `ts_${index}`
                                    };
                                    const isBooked = isSpaceBooked(space.id, timeSlotWithId)
                                    const bookingDetails = isBooked ? getBookingDetails(space.id, timeSlotWithId) : null
                                    const blockStatus = isSlotBlocked(space.id, timeSlotWithId)

                                  return (
                                    <div
                                      key={timeSlotWithId.id}
                                      className={`p-3 rounded-md flex justify-between items-center ${
                                        blockStatus.blocked
                                          ? 'bg-red-50 border border-red-200'
                                          : isBooked
                                            ? 'bg-gray-50'
                                            : 'bg-gray-50/30'
                                      }`}
                                    >
                                      <div>
                                        <div className={`font-medium ${blockStatus.blocked ? 'text-red-700' : ''}`}>
                                          {timeSlotWithId.description || timeSlotWithId.name || `Slot ${timeSlotWithId.id}`}
                                        </div>
                                        <div className={`text-sm ${blockStatus.blocked ? 'text-red-500' : 'text-muted-foreground'}`}>
                                          {timeSlotWithId.start?.split(':').slice(0, 2).join(':')} - {timeSlotWithId.end?.split(':').slice(0, 2).join(':')}
                                        </div>
                                      </div>

                                      {season.outside ? (
                                        <div className="flex items-center text-sm text-amber-600">
                                          <CalendarIcon size={14} className="mr-1" />
                                          <span>Ej bokningsbar</span>
                                        </div>
                                      ) : blockStatus.blocked ? (
                                        <div className="flex items-center text-sm text-red-600">
                                          <Ban size={14} className="mr-1" />
                                          <span>Spärrad{blockStatus.reason ? `: ${blockStatus.reason}` : ''}</span>
                                        </div>
                                      ) : isBooked ? (
                                        <div className="flex items-center text-sm text-muted-foreground">
                                          <User size={14} className="mr-1" />
                                          Booked by {bookingDetails?.foodtruck?.name ?
                                            typeof bookingDetails.foodtruck.name === 'object' ?
                                              "Another food truck" :
                                              String(bookingDetails.foodtruck.name)
                                            : "Unknown"}
                                        </div>
                                      ) : (
                                        <Button
                                          size="sm"
                                          onClick={() => handleBookSpace(space, timeSlotWithId)}
                                          variant={(() => {
                                            // Check if we're at max bookings
                                            if (bookingRules && futureBookings >= bookingRules.maximum_future_bookings) {
                                              const bookingStartDate = new Date(date || new Date());
                                              const safeStart = timeSlotWithId.start || '00:00';
                                              const formattedStart = safeStart.includes(':') ?
                                                safeStart.split(':').slice(0, 2).join(':') :
                                                safeStart;
                                              
                                              const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num));
                                              bookingStartDate.setHours(startHours, startMinutes, 0, 0);
                                              
                                              // If it's a last-minute booking, use secondary styling
                                              if (isLastMinuteBooking(bookingStartDate)) {
                                                return "secondary";
                                              }
                                              // If at max but not last-minute, use outline styling
                                              return "outline";
                                            }
                                            // Default styling for normal bookings
                                            return "default";
                                          })()}
                                        >
                                          {(() => {
                                            // Check if we're at max bookings
                                            if (bookingRules && futureBookings >= bookingRules.maximum_future_bookings) {
                                              const bookingStartDate = new Date(date || new Date());
                                              const safeStart = timeSlotWithId.start || '00:00';
                                              const formattedStart = safeStart.includes(':') ?
                                                safeStart.split(':').slice(0, 2).join(':') :
                                                safeStart;
                                              
                                              const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num));
                                              bookingStartDate.setHours(startHours, startMinutes, 0, 0);
                                              
                                              // If it's a last-minute booking
                                              if (isLastMinuteBooking(bookingStartDate)) {
                                                return (
                                                  <>
                                                    <Clock size={14} className="mr-1" />
                                                    Last-Minute
                                                  </>
                                                );
                                              }
                                              // If at max but not last-minute
                                              return (
                                                <>
                                                  <AlertCircle size={14} className="mr-1" />
                                                  View Status
                                                </>
                                              );
                                            }
                                            // Default for normal bookings
                                            return (
                                              <>
                                                <Check size={14} className="mr-1" />
                                                Book
                                              </>
                                            );
                                          })()}
                                        </Button>
                                      )}
                                    </div>
                                  )
                                })) : (
                                  <div className="p-3 text-center text-muted-foreground">
                                    No time slots available for this space
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
          
          {/* Booking Confirmation Dialog */}
          {showBookingConfirm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-md w-full m-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Confirm Booking</h3>
                  <button 
                    onClick={cancelBooking}
                    className="text-gray-500 hover:text-gray-700"
                    disabled={isBooking}
                  >
                    <X size={20} />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 bg-gray-50 rounded-md">
                    <div className="flex items-start gap-3">
                      <MapPin className="mt-0.5 text-primary" size={18} />
                      <div>
                        <p className="font-medium">{bookingSpace?.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {bookingSpace?.description ? bookingSpace.description : "No description available"}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-gray-50 rounded-md">
                    <div className="flex items-start gap-3">
                      <CalendarIcon className="mt-0.5 text-primary" size={18} />
                      <div>
                        <p className="font-medium">{date ? format(date, "EEEE, MMMM do, yyyy") : ""}</p>
                        <p className="text-sm text-muted-foreground">
                          {bookingTimeSlot?.description || bookingTimeSlot?.name || `Slot ${bookingTimeSlot?.id}`}: {bookingTimeSlot?.start?.split(':').slice(0, 2).join(':')} - {bookingTimeSlot?.end?.split(':').slice(0, 2).join(':')}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-gray-50 rounded-md">
                    <div className="flex items-start gap-3">
                      <Soup className="mt-0.5 text-primary" size={18} />
                      <div>
                        <p className="font-medium">{userFoodTruck?.name}</p>
                        <p className="text-sm text-muted-foreground">Your food truck</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Booking status indicator */}
                {(() => {
                  // If we haven't reached max bookings, show a success indicator
                  if (!bookingRules || futureBookings < bookingRules.maximum_future_bookings) {
                    return (
                      <div className="mt-4 p-4 rounded-md bg-green-50 border border-green-200">
                        <div className="flex items-start gap-2">
                          <CircleCheck className="h-5 w-5 text-green-500 mt-0.5" />
                          <div>
                            <p className="font-medium text-green-800">Booking available</p>
                            <p className="text-sm text-green-600 mt-1">
                              You can book this time slot
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  
                  // If at max bookings but it's a last-minute booking
                  if (date && bookingTimeSlot) {
                    const bookingStartDate = new Date(date);
                    const formattedStart = bookingTimeSlot.start.includes(':') ? 
                      bookingTimeSlot.start.split(':').slice(0, 2).join(':') : 
                      bookingTimeSlot.start;
                    
                    const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num));
                    bookingStartDate.setHours(startHours, startMinutes, 0, 0);
                    
                    if (isLastMinuteBooking(bookingStartDate)) {
                      return (
                        <div className="mt-4 p-4 rounded-md bg-blue-50 border border-blue-200">
                          <div className="flex items-start gap-2">
                            <Clock className="h-5 w-5 text-blue-500 mt-0.5" />
                            <div>
                              <p className="font-medium text-blue-800">Last-minute booking available</p>
                              <p className="text-sm text-blue-600 mt-1">
                                This booking is within the {bookingRules.last_minute_booking_hours} hour last-minute window, which allows you to exceed your maximum booking limit.
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  }
                  
                  // At max bookings and not a last-minute booking
                  return (
                    <div className="mt-4 p-4 rounded-md bg-amber-50 border border-amber-200">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
                        <div>
                          <p className="font-medium text-amber-800">Maximum bookings reached</p>
                          <p className="text-sm text-amber-600 mt-1">
                            You have reached your maximum of {bookingRules.maximum_future_bookings} future bookings. You can either cancel an existing booking or make a last-minute booking (within {bookingRules.last_minute_booking_hours} hours).
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex justify-end gap-3 mt-6">
                  <Button
                    variant="outline"
                    onClick={cancelBooking}
                    disabled={isBooking}
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={confirmBooking}
                    disabled={(() => {
                      // Disable if already booking
                      if (isBooking) return true;
                      
                      // Disable if at booking limit and not a last-minute booking
                      if (bookingRules && futureBookings >= bookingRules.maximum_future_bookings && date && bookingTimeSlot) {
                        const bookingStartDate = new Date(date);
                        const formattedStart = bookingTimeSlot.start.includes(':') ? 
                          bookingTimeSlot.start.split(':').slice(0, 2).join(':') : 
                          bookingTimeSlot.start;
                        
                        const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num));
                        bookingStartDate.setHours(startHours, startMinutes, 0, 0);
                        
                        return !isLastMinuteBooking(bookingStartDate);
                      }
                      
                      return false;
                    })()}
                    variant={(() => {
                      // Use secondary variant for last-minute bookings
                      if (bookingRules && futureBookings >= bookingRules.maximum_future_bookings && date && bookingTimeSlot) {
                        const bookingStartDate = new Date(date);
                        const formattedStart = bookingTimeSlot.start.includes(':') ? 
                          bookingTimeSlot.start.split(':').slice(0, 2).join(':') : 
                          bookingTimeSlot.start;
                        
                        const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num));
                        bookingStartDate.setHours(startHours, startMinutes, 0, 0);
                        
                        if (isLastMinuteBooking(bookingStartDate)) {
                          return "secondary";
                        }
                      }
                      
                      return "default";
                    })()}
                  >
                    {(() => {
                      if (isBooking) {
                        return (
                          <>
                            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-b-transparent"></div>
                            Processing...
                          </>
                        );
                      }
                      
                      if (bookingRules && futureBookings >= bookingRules.maximum_future_bookings && date && bookingTimeSlot) {
                        const bookingStartDate = new Date(date);
                        const formattedStart = bookingTimeSlot.start.includes(':') ? 
                          bookingTimeSlot.start.split(':').slice(0, 2).join(':') : 
                          bookingTimeSlot.start;
                        
                        const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num));
                        bookingStartDate.setHours(startHours, startMinutes, 0, 0);
                        
                        if (isLastMinuteBooking(bookingStartDate)) {
                          return (
                            <>
                              <Clock className="mr-2 h-4 w-4" />
                              Confirm Last-Minute Booking
                            </>
                          );
                        }
                      }
                      
                      return (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Confirm Booking
                        </>
                      );
                    })()}
                  </Button>
                </div>
                
                {bookingError && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                    <div className="flex items-start gap-2">
                      <X className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-red-700">Bokningen misslyckades</p>
                        <p className="text-sm text-red-600 mt-1">{bookingError}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </SidebarProvider>
    </ProtectedRoute>
  )
}