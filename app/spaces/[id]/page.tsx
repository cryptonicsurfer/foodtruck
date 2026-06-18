"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { format, addDays } from "date-fns"
import { ProtectedRoute } from "@/components/protected-route"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { Soup, MapPin, Clock, Calendar as CalendarIcon, ChevronLeft, ListChecks, Menu, Home, User, List, Check, X, AlertCircle, CircleCheck } from "lucide-react"
import { BookingConfirmationModal } from "@/components/booking-confirmation-modal"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/lib/auth-context"
import { 
  getAllSpaces, 
  getUserFoodTruck, 
  getBookingsForDateRange,
  createBooking,
  getBookingRules,
  getFoodTruckBookings
} from "@/app/actions"
import SpacesMap from "@/components/spaces-map"

export default function SpaceDetailsPage() {
  const params = useParams<{id: string}>()
  const { user, logout } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const [space, setSpace] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [date, setDate] = useState<Date>(new Date())
  const [bookings, setBookings] = useState<any[]>([])
  const [userFoodTruck, setUserFoodTruck] = useState<any>(null)
  const [bookingRules, setBookingRules] = useState<any>(null)
  const [showBookingConfirm, setShowBookingConfirm] = useState(false)
  const [bookingTimeSlot, setBookingTimeSlot] = useState<any>(null)
  const [isBooking, setIsBooking] = useState(false)
  const [bookingError, setBookingError] = useState<string | undefined>(undefined)

  const loadSpaceDetails = async () => {
    setIsLoading(true)
    setError("")
    
    try {
      // Get the space ID from the route params
      const spaceId = params.id
      
      if (!spaceId) {
        setError("Space ID is missing")
        setIsLoading(false)
        return
      }
      
      // Load all spaces and find the specific one
      // Note: In a real app, you'd have a getSpaceById API
      const spacesResult = await getAllSpaces()
      
      if (spacesResult.success) {
        const spaceData = spacesResult.data?.find(s => String(s.id) === spaceId)
        
        if (spaceData) {
          setSpace(spaceData)
        } else {
          setError("Space not found")
        }
      } else if (spacesResult.error) {
        console.error("Error loading space:", spacesResult.error)
        if (spacesResult.error.includes("Invalid email or password") || 
            spacesResult.error.includes("Not authenticated")) {
          setError("Authentication error. Please log in again.")
        } else {
          setError(`Failed to load space: ${spacesResult.error}`)
        }
      }
    } catch (err) {
      console.error("Error loading space details:", err)
      if (err instanceof Error && 
          (err.message.includes("Invalid email or password") || 
           err.message.includes("Not authenticated"))) {
        setError("Authentication error. Please log in again.")
      } else {
        setError("Failed to load space details")
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Get map center from space location
  const getMapCenter = () => {
    if (space?.location?.coordinates) {
      // Convert from [longitude, latitude] to {lat, lng}
      return {
        lat: space.location.coordinates[1],
        lng: space.location.coordinates[0]
      }
    }
    
    // Default to Falkenberg, Sweden
    return { lat: 56.9055, lng: 12.4912 }
  }

  // Load bookings for the selected date
  const loadBookingsForDate = async (selectedDate: Date) => {
    if (!space) return

    try {
      // Create start and end date for the selected day
      const startDate = new Date(selectedDate)
      startDate.setHours(0, 0, 0, 0)
      
      const endDate = new Date(selectedDate)
      endDate.setHours(23, 59, 59, 999)
      
      // Load bookings for the date range
      const bookingsResult = await getBookingsForDateRange(
        startDate.toISOString(), 
        endDate.toISOString()
      )

      if (bookingsResult.success) {
        setBookings(bookingsResult.data || [])
      } else if (bookingsResult.error) {
        console.error("Error loading bookings:", bookingsResult.error)
      }
    } catch (err) {
      console.error("Error loading booking data:", err)
    }
  }

  // Check if a time slot is booked for the current space
  const isTimeSlotBooked = (timeSlot: any) => {
    if (!bookings || !bookings.length || !space) return false
    // Guard against malformed time slots (null/missing start or end).
    if (!timeSlot || !timeSlot.start || !timeSlot.end) return false

    const formatTimeString = (timeStr: string) => {
      return timeStr.includes(':') ? timeStr.split(':').slice(0, 2).join(':') : timeStr
    }

    const timeSlotStart = new Date(date)
    const formattedStart = formatTimeString(timeSlot.start)
    const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num))
    timeSlotStart.setHours(startHours, startMinutes, 0, 0)

    const timeSlotEnd = new Date(date)
    const formattedEnd = formatTimeString(timeSlot.end)
    const [endHours, endMinutes] = formattedEnd.split(':').map(num => parseInt(num))
    timeSlotEnd.setHours(endHours, endMinutes, 0, 0)
    // If end time is before start time, the slot spans midnight
    if (endHours < startHours) {
      timeSlotEnd.setDate(timeSlotEnd.getDate() + 1)
    }

    return bookings.some(booking => {
      try {
        if (!booking || !booking.start || !booking.end || !booking.space) {
          return false
        }

        if (booking.space.id !== space.id) {
          return false
        }

        const bookingStart = new Date(booking.start)
        const bookingEnd = new Date(booking.end)
        // Handle overnight bookings where end is before start
        if (bookingEnd <= bookingStart) {
          bookingEnd.setDate(bookingEnd.getDate() + 1)
        }

        return bookingStart < timeSlotEnd && bookingEnd > timeSlotStart
      } catch (error) {
        console.error("Error processing booking in isTimeSlotBooked:", error, booking)
        return false
      }
    })
  }

  // Get booking details for a time slot
  const getBookingDetails = (timeSlot: any) => {
    if (!bookings || !bookings.length || !space) return null
    // Guard against malformed time slots (null/missing start or end).
    if (!timeSlot || !timeSlot.start || !timeSlot.end) return null

    const formatTimeString = (timeStr: string) => {
      return timeStr.includes(':') ? timeStr.split(':').slice(0, 2).join(':') : timeStr
    }

    const timeSlotStart = new Date(date)
    const formattedStart = formatTimeString(timeSlot.start)
    const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num))
    timeSlotStart.setHours(startHours, startMinutes, 0, 0)

    const timeSlotEnd = new Date(date)
    const formattedEnd = formatTimeString(timeSlot.end)
    const [endHours, endMinutes] = formattedEnd.split(':').map(num => parseInt(num))
    timeSlotEnd.setHours(endHours, endMinutes, 0, 0)
    // If end time is before start time, the slot spans midnight
    if (endHours < startHours) {
      timeSlotEnd.setDate(timeSlotEnd.getDate() + 1)
    }

    return bookings.find(booking => {
      try {
        if (!booking || !booking.start || !booking.end || !booking.space) {
          return false
        }

        if (booking.space.id !== space.id) {
          return false
        }

        const bookingStart = new Date(booking.start)
        const bookingEnd = new Date(booking.end)
        // Handle overnight bookings where end is before start
        if (bookingEnd <= bookingStart) {
          bookingEnd.setDate(bookingEnd.getDate() + 1)
        }

        return bookingStart < timeSlotEnd && bookingEnd > timeSlotStart
      } catch (error) {
        console.error("Error processing booking in getBookingDetails:", error, booking)
        return false
      }
    })
  }

  // Check if a booking is within the last-minute booking window
  const isLastMinuteBooking = (timeSlot: any): boolean => {
    if (!bookingRules || !timeSlot || !timeSlot.start) return false
    
    try {
      const formatTimeString = (timeStr: string) => {
        return timeStr.includes(':') ? timeStr.split(':').slice(0, 2).join(':') : timeStr
      }
  
      // Create a date object from the selected date
      const timeSlotStart = new Date(date)
      
      // Format the time string and extract hours and minutes
      const formattedStart = formatTimeString(timeSlot.start)
      const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num))
      
      // Set the hours and minutes on the date object
      timeSlotStart.setHours(startHours, startMinutes, 0, 0)
      
      const now = new Date()
      
      // Calculate hours until booking
      const hoursUntilBooking = (timeSlotStart.getTime() - now.getTime()) / (1000 * 60 * 60)
      
      console.log("Last-minute check:", {
        timeSlot,
        date: date.toISOString(),
        timeSlotStart: timeSlotStart.toISOString(),
        now: now.toISOString(),
        hoursUntilBooking,
        lastMinuteThreshold: bookingRules.last_minute_booking_hours,
        isLastMinute: hoursUntilBooking <= bookingRules.last_minute_booking_hours
      })
      
      // If the booking is within the last-minute window, return true
      return hoursUntilBooking <= bookingRules.last_minute_booking_hours
    } catch (error) {
      console.error("Error in isLastMinuteBooking:", error)
      return false
    }
  }

  // State to store all future bookings for the user's food truck
  const [allFutureBookingsCount, setAllFutureBookingsCount] = useState(0)
  
  // Load all future bookings for the user's food truck
  const loadAllFutureBookings = async () => {
    if (!userFoodTruck) return
    
    try {
      const result = await getFoodTruckBookings(userFoodTruck.id)
      if (result.success && result.data) {
        // Filter to just future bookings
        const now = new Date()
        const futureBookings = result.data.filter((booking: any) => {
          return new Date(booking.start) > now
        })
        setAllFutureBookingsCount(futureBookings.length)
      }
    } catch (error) {
      console.error("Error loading all future bookings:", error)
    }
  }
  
  // Get the count of future bookings for the user
  const getFutureBookingsCount = (): number => {
    // Return the pre-fetched count of all future bookings
    return allFutureBookingsCount
  }
  
  // Check if user has reached maximum bookings
  const hasReachedMaxBookings = (): boolean => {
    if (!userFoodTruck || !bookingRules) return false
    
    return allFutureBookingsCount >= bookingRules.maximum_future_bookings
  }

  // Start the booking process
  const handleBookSpace = (timeSlot: any) => {
    console.log("=== handleBookSpace called ===", timeSlot)

    if (!userFoodTruck) {
      toast({
        title: "Food truck not found",
        description: "You need a registered food truck to make bookings",
        variant: "destructive"
      })
      return
    }

    if (!space) {
      toast({
        title: "Space not found",
        description: "Unable to book this space",
        variant: "destructive"
      })
      return
    }

    console.log("Opening booking confirmation modal")
    setBookingTimeSlot(timeSlot)
    setShowBookingConfirm(true)
  }

  // Create the actual booking
  const confirmBooking = async () => {
    console.log("=== confirmBooking STARTED ===")
    console.log("showBookingConfirm state:", showBookingConfirm)

    if (!userFoodTruck || !space || !bookingTimeSlot || !date) {
      console.log("Missing data - returning early")
      toast({
        title: "Error",
        description: "Missing required information for booking",
        variant: "destructive"
      })
      return
    }

    console.log("Setting isBooking=true, clearing error")
    setIsBooking(true)
    setBookingError(undefined) // Clear any previous error
    
    try {
      // Format of time_slots can be "08:00:00" or "08:00"
      const formatTimeString = (timeStr: string) => {
        return timeStr.includes(':') ? timeStr.split(':').slice(0, 2).join(':') : timeStr
      }
      
      // Get the selected day and use consistent local time for both booking and last-minute check
      const selectedDay = new Date(date)
      console.log("Selected day for booking:", selectedDay.toISOString())
      
      const formattedStart = formatTimeString(bookingTimeSlot.start)
      const [startHours, startMinutes] = formattedStart.split(':').map(num => parseInt(num))
      
      // First create dates in local time for consistency
      const localStartDate = new Date(selectedDay)
      localStartDate.setHours(startHours, startMinutes, 0, 0)
      console.log("Local start date:", localStartDate.toISOString())
      
      // Then convert to UTC for API calls
      const startDate = new Date(Date.UTC(
        selectedDay.getFullYear(),
        selectedDay.getMonth(),
        selectedDay.getDate(),
        startHours,
        startMinutes,
        0
      ))
      console.log("UTC start date:", startDate.toISOString())
      
      const formattedEnd = formatTimeString(bookingTimeSlot.end)
      const [endHours, endMinutes] = formattedEnd.split(':').map(num => parseInt(num))
      
      // Also create local end date
      const localEndDate = new Date(selectedDay)
      localEndDate.setHours(endHours, endMinutes, 0, 0)
      console.log("Local end date:", localEndDate.toISOString())
      
      // Then convert to UTC for API calls
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
      console.log("UTC end date:", endDate.toISOString())
      
      // Create booking data
      const bookingData = {
        foodtruck: userFoodTruck.id,
        space: space.id,
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
      
      // Call the createBooking action
      console.log("Calling createBooking with:", bookingData)
      const result = await createBooking(bookingData)
      console.log("=== createBooking result:", JSON.stringify(result))

      if (result.success) {
        console.log("Booking SUCCESS - closing modal")
        toast({
          title: "Booking confirmed!",
          description: `You have booked ${space.name} for ${bookingTimeSlot.description || `${bookingTimeSlot.start} - ${bookingTimeSlot.end}`} on ${format(date, "MMMM do, yyyy")}`,
          variant: "default"
        })
        
        // Close the confirmation dialog and refresh the bookings
        setShowBookingConfirm(false)
        
        // Refresh the bookings for the current date
        loadBookingsForDate(date)
        
        // Refresh all future bookings count
        loadAllFutureBookings()
        
        // Increment the counter immediately for better UX
        setAllFutureBookingsCount(prev => prev + 1)
      } else if (result.error) {
        console.log("Booking ERROR - keeping modal open with error:", result.error)
        console.log("Current showBookingConfirm state before setBookingError:", showBookingConfirm)
        setBookingError(result.error)
        console.log("Called setBookingError, modal should stay open")
        toast({
          title: "Booking failed",
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
    console.log("=== cancelBooking called - closing modal ===")
    console.log("Stack trace:", new Error().stack)
    setShowBookingConfirm(false)
    setBookingTimeSlot(null)
    setBookingError(undefined)
  }

  // Load user's food truck and booking rules
  const loadUserData = async () => {
    try {
      // Get user's food truck
      const result = await getUserFoodTruck()
      if (result.success && result.data) {
        setUserFoodTruck(result.data)
      }
      
      // Get booking rules
      const rulesResult = await getBookingRules()
      if (rulesResult.success && rulesResult.data) {
        setBookingRules(rulesResult.data)
      }
    } catch (err) {
      console.error("Error loading user data:", err)
    }
  }

  // Load data on component mount
  useEffect(() => {
    loadSpaceDetails()
    loadUserData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])
  
  // Load all future bookings when userFoodTruck becomes available
  useEffect(() => {
    if (userFoodTruck && userFoodTruck.id) {
      loadAllFutureBookings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFoodTruck])

  // Load bookings when date or space changes
  useEffect(() => {
    if (space) {
      loadBookingsForDate(date)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, space])

  return (
    <ProtectedRoute>
      <SidebarProvider>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex-1 p-4 md:p-6 overflow-auto w-full">
            <CustomSidebarTrigger />
            <header className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-2">
                <Soup size={24} className="text-primary mr-2" />
                <div>
                  <h1 className="text-2xl font-bold flex items-center gap-2 hidden lg:block">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => router.push('/spaces')}
                    >
                      <ChevronLeft className="h-5 w-5" />
                      <span className="sr-only">Back</span>
                    </Button>
                    {isLoading ? "Loading..." : space?.name || "Space Not Found"}
                  </h1>
                  <p className="text-muted-foreground hidden lg:block">View space details and availability</p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => router.push('/spaces-list')}
                >
                  <ListChecks className="mr-2 h-4 w-4" />
                  All Spaces
                </Button>
                
                <Button
                  onClick={() => router.push('/booking')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  Book Space
                </Button>
              </div>
            </header>

            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-6">
                <p className="mb-2">{error}</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadSpaceDetails}
                  >
                    Try again
                  </Button>
                  {error.includes("Authentication") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        logout();
                        router.push("/login");
                      }}
                    >
                      Return to login
                    </Button>
                  )}
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center items-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              </div>
            ) : space ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 w-full">
                {/* Space Details Column */}
                <div className="lg:col-span-1">
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle className="flex items-center">
                        <MapPin className="mr-2 h-5 w-5" />
                        Space Information
                      </CardTitle>
                      <CardDescription>
                        Details about this food truck space
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div>
                        {space.image && (
                          <div className="mb-4 rounded-md overflow-hidden">
                            <img 
                              src={`${process.env.NEXT_PUBLIC_DIRECTUS_URL || 'https://cms.businessfalkenberg.se'}/assets/${space.image}`}
                              alt={space.name}
                              className="w-full h-48 object-cover"
                              onError={(e) => {
                                // On error, replace with placeholder
                                (e.target as HTMLImageElement).src = '/placeholder.svg';
                              }}
                            />
                          </div>
                        )}
                        <h3 className="text-lg font-medium">{space.name}</h3>
                        <p className="text-muted-foreground">
                          {space.description || "No description available"}
                        </p>
                      </div>

                      <Separator />

                      <div>
                        <h4 className="font-medium flex items-center mb-2">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          Select Date
                        </h4>
                        <div className="flex justify-center">
                          <CalendarComponent
                            mode="single"
                            selected={date}
                            onSelect={(newDate) => newDate && setDate(newDate)}
                            weekStartsOn={1}
                            className="rounded-md border"
                            disabled={{ 
                              before: new Date(),
                              after: bookingRules ? addDays(new Date(), bookingRules.maximum_days_ahead) : undefined 
                            }}
                          />
                        </div>
                        <p className="text-sm text-center mt-2 text-muted-foreground">
                          {date ? (
                            <>Showing availability for <strong>{format(date, "EEEE, MMMM do, yyyy")}</strong></>
                          ) : (
                            "Please select a date"
                          )}
                        </p>
                      </div>

                      <Separator />

                      <div>
                        <h4 className="font-medium flex items-center mb-2">
                          <Clock className="mr-2 h-4 w-4" />
                          Time Slots
                        </h4>
                        
                        {space.time_slots && space.time_slots.length > 0 ? (
                          <div className="space-y-2">
                            {space.time_slots.map((slot: any, index: number) => {
                              const isBooked = isTimeSlotBooked(slot);
                              const bookingDetails = isBooked ? getBookingDetails(slot) : null;
                              
                              return (
                                <div 
                                  key={index} 
                                  className={`p-3 rounded-md flex justify-between items-center ${isBooked ? 'bg-gray-50' : 'bg-green-50'}`}
                                >
                                  <div>
                                    <div className="font-medium">{slot.description || `Time Slot ${index + 1}`}</div>
                                    <div className="text-sm text-muted-foreground">
                                      {slot.start?.substring(0, 5)} - {slot.end?.substring(0, 5)}
                                    </div>
                                    {isBooked && (
                                      <div className="text-muted-foreground text-sm flex items-center">
                                        <User size={12} className="mr-1" />
                                        Booked by {bookingDetails?.foodtruck?.name || "Another food truck"}
                                      </div>
                                    )}
                                  </div>
                                  
                                  {!isBooked && (
                                    <Button
                                      size="sm"
                                      onClick={() => handleBookSpace(slot)}
                                      variant={hasReachedMaxBookings() ? 
                                        (isLastMinuteBooking(slot) ? "secondary" : "outline") 
                                        : "default"}
                                    >
                                      {isLastMinuteBooking(slot) && hasReachedMaxBookings() ? (
                                        <>
                                          <Clock size={14} className="mr-1" />
                                          Last-Minute
                                        </>
                                      ) : hasReachedMaxBookings() ? (
                                        <>
                                          <AlertCircle size={14} className="mr-1" />
                                          View Status
                                        </>
                                      ) : (
                                        <>
                                          <Check size={14} className="mr-1" />
                                          Book
                                        </>
                                      )}
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">No defined time slots</p>
                        )}
                      </div>

                      <Separator />

                      <div>
                        <h4 className="font-medium flex items-center mb-2">
                          <MapPin className="mr-2 h-4 w-4" />
                          Location
                        </h4>
                        <p className="text-muted-foreground">
                          {space.location ? 
                            typeof space.location === 'object' ?
                              space.location.coordinates ? 
                                `Coordinates: ${space.location.coordinates[1].toFixed(6)}, ${space.location.coordinates[0].toFixed(6)}` :
                                "Location data available" :
                              String(space.location) :
                            "No location specified"}
                        </p>
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button
                        onClick={() => router.push('/booking')}
                        className="w-full"
                        variant="outline"
                      >
                        View All Spaces
                      </Button>
                    </CardFooter>
                  </Card>
                </div>

                {/* Map Column */}
                <div className="lg:col-span-2">
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle className="flex items-center">
                        <MapPin className="mr-2 h-5 w-5" />
                        Location Map
                      </CardTitle>
                      <CardDescription>
                        Map showing the location of this space
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      {space.location && space.location.coordinates ? (
                        <SpacesMap 
                          spaces={[space]} 
                          center={getMapCenter()}
                          zoom={19}
                          height="65vh"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-64 bg-muted">
                          <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
                          <p className="text-muted-foreground">
                            No location coordinates available for this space
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <MapPin className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Space Not Found</h3>
                <p className="text-muted-foreground mb-6">
                  The space you're looking for doesn't exist or might have been removed
                </p>
                <Button
                  onClick={() => router.push('/spaces-list')}
                >
                  View All Spaces
                </Button>
              </div>
            )}
          </div>

          {/* Booking Confirmation Modal */}
          <BookingConfirmationModal
            isOpen={showBookingConfirm}
            onClose={cancelBooking}
            onConfirm={confirmBooking}
            isBooking={isBooking}
            space={space}
            foodTruck={userFoodTruck}
            date={date}
            timeSlot={bookingTimeSlot}
            bookingRules={bookingRules}
            futureBookings={getFutureBookingsCount()}
            isLastMinuteBooking={isLastMinuteBooking}
            hasReachedMaxBookings={hasReachedMaxBookings}
            error={bookingError}
          />
        </div>
      </SidebarProvider>
    </ProtectedRoute>
  )
}