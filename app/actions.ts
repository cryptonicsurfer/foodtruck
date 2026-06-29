'use server'

import { cookies } from 'next/headers'
import { revalidatePath, revalidateTag } from 'next/cache'
import { directusServer } from '@/lib/directus-server'
import { serverEnv } from '@/lib/env'

/**
 * Login with email and password
 */
export async function login(email: string, password: string) {
  try {
    const response = await directusServer.login(email, password)
    
    // Set access token in a cookie
    const cookieStore = await cookies()
    cookieStore.set('access_token', response.data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    })
    
    cookieStore.set('refresh_token', response.data.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    })
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Login error:', error)
    
    // Provide a more user-friendly error message
    let errorMessage = 'Failed to login';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Make login errors even more user-friendly
      if (errorMessage.includes('401') || errorMessage.includes('Invalid credentials')) {
        errorMessage = 'Invalid email or password';
      } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
        errorMessage = 'Unable to connect to the server. Please check your internet connection.';
      }
    }
    
    return { success: false, error: errorMessage }
  }
}

/**
 * Request password reset
 */
export async function requestPasswordReset(email: string) {
  try {
    const resetUrl = `${serverEnv.APP_URL}/auth/password-reset`
    console.log(`Requesting password reset with resetUrl: ${resetUrl}`);
    
    const response = await directusServer.requestPasswordReset(email, resetUrl)
    
    // Password reset requests may return a 204 No Content, which is a success with no data
    return { success: true, data: response.data || {} }
  } catch (error) {
    console.error('Password request error:', error)
    
    // Provide a more user-friendly error message
    let errorMessage = 'Failed to request password reset';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Make password request errors more user-friendly
      if (errorMessage.includes('not found') || errorMessage.includes('no matching user')) {
        errorMessage = 'If your email is registered, you will receive a password reset link.';
        // Note: For security, we don't want to reveal whether an email exists in the system
        // So we return "success" even when there's an error for email not found
        return { success: true, data: {} };
      } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
        errorMessage = 'Unable to connect to the server. Please check your internet connection.';
      }
    }
    
    return { success: false, error: errorMessage }
  }
}

/**
 * Reset password with token
 */
export async function resetPassword(token: string, password: string) {
  try {
    const response = await directusServer.resetPassword(token, password)
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Password reset error:', error)
    
    // Provide a more user-friendly error message
    let errorMessage = 'Failed to reset password';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Make password reset errors more user-friendly
      if (errorMessage.includes('expired') || errorMessage.includes('invalid token')) {
        errorMessage = 'Your password reset link has expired or is invalid. Please request a new one.';
      } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
        errorMessage = 'Unable to connect to the server. Please check your internet connection.';
      }
    }
    
    return { success: false, error: errorMessage }
  }
}

/**
 * Get current user data
 */
export async function getCurrentUser() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    const response = await directusServer.getCurrentUser(token)
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Get user error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get user data' 
    }
  }
}

/**
 * Get user's food truck
 */
export async function getUserFoodTruck() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    const response = await directusServer.getFoodTruckByUser(token)
    
    // Return the first food truck (users should only have one food truck)
    return { 
      success: true, 
      data: response.data && response.data.length > 0 ? response.data[0] : null
    }
  } catch (error) {
    console.error('Get food truck error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get food truck data' 
    }
  }
}

/**
 * Update food truck information
 */
export async function updateFoodTruck(id: string, data: any) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    const response = await directusServer.updateFoodTruck(id, data, token)
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Update food truck error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to update food truck' 
    }
  }
}

/**
 * Upload image for food truck
 */
export async function uploadFoodTruckImage(formData: FormData) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    // 1. Upload the file to Directus
    const fileResponse = await directusServer.uploadFile(formData, token)
    
    if (!fileResponse || !fileResponse.data || !fileResponse.data.id) {
      throw new Error('File upload failed')
    }
    
    // Return the file ID and information
    return { 
      success: true, 
      data: fileResponse.data 
    }
  } catch (error) {
    console.error('Image upload error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to upload image' 
    }
  }
}

/**
 * Get food truck bookings
 */
export async function getFoodTruckBookings(foodTruckId: string) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    const response = await directusServer.getFoodTruckBookings(foodTruckId, token)
    
    // Tag the request so it can be revalidated later
    revalidateTag(`bookings-${foodTruckId}`)
    revalidateTag('bookings')
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Get bookings error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get bookings' 
    }
  }
}

/**
 * Get booking rules
 */
export async function getBookingRules() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    const response = await directusServer.getBookingRules(token)
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Get booking rules error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get booking rules' 
    }
  }
}

/**
 * Get all spaces
 */
export async function getAllSpaces() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    const response = await directusServer.getSpaces(token)
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Get spaces error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get spaces' 
    }
  }
}

/**
 * Get all food trucks
 */
export async function getAllFoodTrucks() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    const response = await directusServer.getFoodTrucks(token)
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Get food trucks error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get food trucks' 
    }
  }
}

/**
 * Get spaces with bookings for a date range
 */
export async function getSpacesWithBookings(startDate: string, endDate: string) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    const response = await directusServer.getSpacesWithBookings(startDate, endDate, token)
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Get spaces with bookings error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get spaces with bookings' 
    }
  }
}

/**
 * Get all bookings for a date range
 */
export async function getBookingsForDateRange(startDate: string, endDate: string) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    const response = await directusServer.getBookingsForDateRange(startDate, endDate, token)
    
    // Tag the request for date-specific revalidation
    const startDateFormat = new Date(startDate).toISOString().split('T')[0]
    const endDateFormat = new Date(endDate).toISOString().split('T')[0]
    revalidateTag(`bookings-range-${startDateFormat}-${endDateFormat}`)
    revalidateTag('bookings')
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Get bookings error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get bookings'
    }
  }
}

/**
 * Get blocked dates for spaces (for any authenticated user)
 */
export async function getSpaceBlockedDates() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.getSpaceBlockedDates(token)

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Get blocked dates error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get blocked dates'
    }
  }
}

/**
 * Create a new booking
 */
export async function createBooking(bookingData: {
  foodtruck: string;
  space: string;
  start: string;
  end: string;
}) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value
    
    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }
    
    // First check if the user has reached their maximum bookings
    const rulesResult = await getBookingRules()
    if (!rulesResult.success) {
      return { success: false, error: 'Failed to check booking rules' }
    }
    
    const rules = rulesResult.data
    
    // Get the user's food truck
    const foodTruckResult = await getUserFoodTruck()
    if (!foodTruckResult.success || !foodTruckResult.data) {
      return { success: false, error: 'Failed to get food truck information' }
    }
    
    const foodTruck = foodTruckResult.data
    
    // Get current bookings for this food truck
    const now = new Date()
    const bookingsResult = await getFoodTruckBookings(foodTruck.id)
    
    if (!bookingsResult.success) {
      return { success: false, error: 'Failed to check current bookings' }
    }
    
    // Filter to future bookings only
    const futureBookings = (bookingsResult.data || []).filter((booking: any) => {
      return new Date(booking.start) > now
    })
    
    // Extract booking time from the incoming booking
    const bookingStart = new Date(bookingData.start)
    
    // Check if this is a last-minute booking (within the configured hours)
    const hoursUntilBooking = (bookingStart.getTime() - now.getTime()) / (1000 * 60 * 60)
    const isLastMinuteBooking = hoursUntilBooking <= rules.last_minute_booking_hours
    
    console.log("Booking check:", {
      now: now.toISOString(),
      bookingStart: bookingStart.toISOString(),
      hoursUntilBooking,
      lastMinuteThreshold: rules.last_minute_booking_hours,
      isLastMinuteBooking,
      futureBookingsCount: futureBookings.length,
      maxBookings: rules.maximum_future_bookings
    })
    
    // Only apply the maximum booking limit if this is NOT a last-minute booking
    if (futureBookings.length >= rules.maximum_future_bookings && !isLastMinuteBooking) {
      return { 
        success: false, 
        error: `You already have ${rules.maximum_future_bookings} future bookings, which is the maximum allowed. You can still make last-minute bookings (within ${rules.last_minute_booking_hours} hours of the start time).` 
      }
    }
    
    // Check that booking is not too far in the future
    const bookingStartDate = new Date(bookingData.start)
    const maxAllowedDate = new Date()
    maxAllowedDate.setDate(maxAllowedDate.getDate() + rules.maximum_days_ahead)

    if (bookingStartDate > maxAllowedDate) {
      return {
        success: false,
        error: `Bookings can only be made up to ${rules.maximum_days_ahead} days in advance`
      }
    }

    // Normalize end date: if end is before start, the slot spans midnight — add one day
    const bookingEndDate = new Date(bookingData.end)
    if (bookingEndDate <= bookingStartDate) {
      bookingEndDate.setDate(bookingEndDate.getDate() + 1)
      bookingData = { ...bookingData, end: bookingEndDate.toISOString() }
    }

    // Check if the space is blocked for this date
    const bookingDate = bookingData.start.split('T')[0] // Extract YYYY-MM-DD

    // Enforce the space's seasonal booking window (bookable_from / bookable_to).
    // Either bound may be null = open-ended. Compared as plain yyyy-MM-dd strings.
    try {
      const spaceResult = await directusServer.getSpace(bookingData.space, token)
      const space = spaceResult.data
      const from: string | null = space?.bookable_from ? String(space.bookable_from).slice(0, 10) : null
      const to: string | null = space?.bookable_to ? String(space.bookable_to).slice(0, 10) : null
      if ((from && bookingDate < from) || (to && bookingDate > to)) {
        const sv = (d: string) => d.split('-').reverse().join('/') // yyyy-MM-dd → dd/MM/yyyy
        const window = from && to ? `${sv(from)}–${sv(to)}` : from ? `från ${sv(from)}` : `till ${sv(to!)}`
        return {
          success: false,
          error: `Denna plats är endast bokningsbar ${window}`
        }
      }
    } catch (e) {
      console.error('Seasonal window check failed (allowing booking):', e)
    }

    const bookingHour = bookingStartDate.getHours()
    // Morning slot is 06:00-15:00, Evening slot is 16:00-03:00
    const timeSlot: "morning" | "evening" = bookingHour < 16 ? "morning" : "evening"

    console.log("=== Checking if space is blocked ===")
    console.log("Space:", bookingData.space, "Date:", bookingDate, "Time slot:", timeSlot, "Hour:", bookingHour)

    const blockedCheck = await directusServer.isSpaceBlocked(
      bookingData.space,
      bookingDate,
      timeSlot,
      token
    )

    console.log("=== Blocked check result:", JSON.stringify(blockedCheck))

    if (blockedCheck.blocked) {
      const errorMessage = blockedCheck.reason
        ? `Denna plats är spärrad: ${blockedCheck.reason}`
        : 'Denna plats är spärrad för det valda datumet'
      console.log("=== RETURNING ERROR:", errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    }

    // Check for overlapping bookings on the same space and time slot
    const overlapCheck = await directusServer.checkOverlappingBookings(
      bookingData.space,
      bookingData.start,
      bookingData.end,
      token
    )

    if (overlapCheck.data && overlapCheck.data.length > 0) {
      const existingBooking = overlapCheck.data[0]
      const bookedBy = existingBooking.foodtruck?.name || 'en annan foodtruck'
      return {
        success: false,
        error: `Denna plats är redan bokad av ${bookedBy} för den valda tiden`
      }
    }

    // Create the booking
    const response = await directusServer.createBooking(bookingData, token)
    
    // Revalidate booking data
    revalidateTag('bookings')
    revalidatePath('/booking')
    revalidatePath('/')
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Create booking error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create booking' 
    }
  }
}

/**
 * Refresh access token
 */
export async function refreshToken() {
  try {
    const cookieStore = await cookies()
    const refreshToken = cookieStore.get('refresh_token')?.value
    
    if (!refreshToken) {
      return { success: false, error: 'No refresh token' }
    }
    
    const response = await directusServer.refreshToken(refreshToken)
    
    // Update access token in a cookie
    cookieStore.set('access_token', response.data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    })
    
    cookieStore.set('refresh_token', response.data.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    })
    
    return { success: true, data: response.data }
  } catch (error) {
    console.error('Token refresh error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to refresh token' 
    }
  }
}

/**
 * Logout user
 */
export async function logout() {
  const cookieStore = await cookies()
  
  // Clear cookies
  cookieStore.delete('access_token')
  cookieStore.delete('refresh_token')
  
  return { success: true }
}

/**
 * Cancel a booking
 */
export async function cancelBooking(bookingId: string) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    // First verify that the booking belongs to the current user
    const userResult = await getUserFoodTruck()
    if (!userResult.success || !userResult.data) {
      return { success: false, error: 'Unable to verify ownership of this booking' }
    }

    const userFoodTruck = userResult.data

    // Delete the booking
    await directusServer.deleteBooking(bookingId, token)

    // Revalidate booking data
    revalidateTag('bookings')
    revalidatePath('/booking')
    revalidatePath('/')

    return { success: true }
  } catch (error) {
    console.error('Cancel booking error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel booking'
    }
  }
}

// ============================================
// Admin functions (Head of Foodtruck)
// ============================================

const ADMIN_ROLES = ['Administrator', 'Head of Foodtruck']

/**
 * Get current user with role - checks if user has admin access
 */
export async function getCurrentUserWithRole() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.getCurrentUserWithRole(token)
    const isAdmin = ADMIN_ROLES.includes(response.data.role?.name)

    return {
      success: true,
      data: {
        ...response.data,
        isAdmin
      }
    }
  } catch (error) {
    console.error('Get user with role error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get user data'
    }
  }
}

/**
 * Get all food trucks with users (admin only)
 */
export async function adminGetAllFoodTrucks() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.getAllFoodTrucksWithUsers(token)

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin get food trucks error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get food trucks'
    }
  }
}

/**
 * Toggle food truck active status (admin only)
 */
export async function adminSetFoodTruckActive(id: string, active: boolean) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.setFoodTruckActive(id, active, token)

    revalidatePath('/admin')
    revalidateTag('foodtrucks')

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin set food truck active error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update food truck'
    }
  }
}

/**
 * Delete a food truck (admin only)
 * Optionally also deletes the associated user (only if they have Foodtrucker role)
 */
export async function adminDeleteFoodTruck(id: string, deleteUser: boolean = false, userId?: string) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    // First delete the food truck
    await directusServer.deleteFoodTruck(id, token)

    // Then delete the user if requested
    if (deleteUser && userId) {
      try {
        await directusServer.deleteFoodTruckUser(userId, token)
      } catch (userError) {
        console.error('Failed to delete user:', userError)
        // Food truck is already deleted, so we return partial success
        return {
          success: true,
          warning: 'Foodtruck borttagen, men kunde inte ta bort användaren'
        }
      }
    }

    revalidatePath('/admin')
    revalidateTag('foodtrucks')

    return { success: true }
  } catch (error) {
    console.error('Admin delete food truck error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete food truck'
    }
  }
}

/**
 * Update a food truck (admin only)
 */
export async function adminUpdateFoodTruck(id: string, data: { name?: string; description?: string }) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    // Verify admin role
    const userResult = await directusServer.getCurrentUserWithRole(token)
    if (!ADMIN_ROLES.includes(userResult.data.role?.name || '')) {
      return { success: false, error: 'Unauthorized' }
    }

    const response = await directusServer.updateFoodTruck(id, data, token)

    revalidatePath('/admin')
    revalidateTag('foodtrucks')

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin update food truck error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update food truck'
    }
  }
}

/**
 * Update a space's seasonal booking window (admin only).
 * Pass `null` for a field to clear it (= always bookable on that bound).
 */
export async function adminUpdateSpace(
  id: string,
  data: { bookable_from?: string | null; bookable_to?: string | null }
) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    // Verify admin role
    const userResult = await directusServer.getCurrentUserWithRole(token)
    if (!ADMIN_ROLES.includes(userResult.data.role?.name || '')) {
      return { success: false, error: 'Unauthorized' }
    }

    const response = await directusServer.updateSpace(id, data, token)

    revalidatePath('/admin')
    revalidatePath('/booking')
    revalidateTag('bookings')

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin update space error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update space'
    }
  }
}

/**
 * Get blocked dates for spaces (admin only)
 */
export async function adminGetSpaceBlockedDates() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.getSpaceBlockedDates(token)

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin get blocked dates error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get blocked dates'
    }
  }
}

/**
 * Create a blocked date for a space (admin only)
 */
export async function adminCreateSpaceBlockedDate(data: {
  space: number;
  date: string;
  time_slot: "morning" | "evening" | "all_day";
  reason?: string;
}) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.createSpaceBlockedDate(data, token)

    revalidatePath('/admin')
    revalidateTag('blocked-dates')

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin create blocked date error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create blocked date'
    }
  }
}

/**
 * Delete a blocked date (admin only)
 */
export async function adminDeleteSpaceBlockedDate(id: string) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    await directusServer.deleteSpaceBlockedDate(id, token)

    revalidatePath('/admin')
    revalidateTag('blocked-dates')

    return { success: true }
  } catch (error) {
    console.error('Admin delete blocked date error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete blocked date'
    }
  }
}

/**
 * Update booking rules including guidelines URL (admin only)
 */
export async function adminUpdateBookingRules(data: {
  maximum_future_bookings?: number;
  maximum_days_ahead?: number;
  last_minute_booking_hours?: number;
  guidelines_url?: string;
}) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.updateBookingRules(data, token)

    revalidatePath('/admin')
    revalidateTag('booking-rules')

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin update booking rules error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update booking rules'
    }
  }
}

/**
 * Get users without a food truck (for assigning to new food trucks)
 */
export async function adminGetUsersWithoutFoodTruck() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.getUsersWithoutFoodTruck(token)

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin get users without food truck error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get users'
    }
  }
}

/**
 * Create a new food truck user (admin only)
 */
export async function adminCreateFoodTruckUser(data: {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.createFoodTruckUser(data, token)

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin create food truck user error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create user'
    }
  }
}

/**
 * Create a new food truck (admin only)
 */
export async function adminCreateFoodTruck(data: {
  name: string;
  description?: string;
  user: string;
}) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.createFoodTruck(data, token)

    revalidatePath('/admin')
    revalidateTag('foodtrucks')

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin create food truck error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create food truck'
    }
  }
}

// ============================================
// Documents functions
// ============================================

/**
 * Get all published documents (for regular users)
 */
export async function getDocuments() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.getDocuments(token)

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Get documents error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get documents'
    }
  }
}

/**
 * Get all documents for admin (including drafts)
 */
export async function adminGetDocuments() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.getDocumentsAdmin(token)

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin get documents error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get documents'
    }
  }
}

/**
 * Create a document (admin only)
 */
export async function adminCreateDocument(data: {
  title: string;
  description?: string;
  link_type: 'url' | 'file';
  url?: string;
  file?: string;
}) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.createDocument(data, token)

    revalidatePath('/admin')
    revalidatePath('/lankar')
    revalidateTag('documents')

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin create document error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create document'
    }
  }
}

/**
 * Update a document (admin only)
 */
export async function adminUpdateDocument(id: string, data: {
  title?: string;
  description?: string;
  link_type?: 'url' | 'file';
  url?: string;
  file?: string;
  status?: string;
  sort?: number;
}) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    const response = await directusServer.updateDocument(id, data, token)

    revalidatePath('/admin')
    revalidatePath('/lankar')
    revalidateTag('documents')

    return { success: true, data: response.data }
  } catch (error) {
    console.error('Admin update document error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update document'
    }
  }
}

/**
 * Delete a document (admin only)
 */
export async function adminDeleteDocument(id: string) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('access_token')?.value

    if (!token) {
      return { success: false, error: 'Not authenticated' }
    }

    await directusServer.deleteDocument(id, token)

    revalidatePath('/admin')
    revalidatePath('/lankar')
    revalidateTag('documents')

    return { success: true }
  } catch (error) {
    console.error('Admin delete document error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete document'
    }
  }
}