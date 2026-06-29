/**
 * Directus server functions for server-side API communication
 */
import { serverEnv } from "@/lib/env";

interface DirectusErrorResponse {
  errors?: { message?: string }[];
}

const DIRECTUS_URL = serverEnv.DIRECTUS_URL;

/**
 * Create a Directus request with proper error handling
 */
async function directusRequest<T>(
  endpoint: string,
  options: RequestInit
): Promise<T> {
  const url = `${DIRECTUS_URL}${endpoint}`;
  const isAuthEndpoint = endpoint.startsWith('/auth/login');

  try {
    console.log(`Making Directus request to: ${url}`);
    const response = await fetch(url, options);

    if (!response.ok) {
      try {
        const errorData = await response.json() as DirectusErrorResponse;

        // Get the actual error message or create a user-friendly one
        let errorMessage = errorData.errors?.[0]?.message;

        // If no specific error message, create a user-friendly one based on status code
        if (!errorMessage) {
          if (response.status === 401) {
            errorMessage = isAuthEndpoint ? "Invalid email or password" : "Session expired";
          } else if (response.status === 403) {
            errorMessage = "You don't have permission to access this resource";
          } else if (response.status === 404) {
            errorMessage = "The requested resource was not found";
          } else if (response.status === 429) {
            errorMessage = "Too many requests, please try again later";
          } else if (response.status >= 500) {
            errorMessage = "Server error, please try again later";
          } else {
            errorMessage = `Request failed (${response.status})`;
          }
        }

        throw new Error(errorMessage);
      } catch (jsonError) {
        // If we can't parse the error as JSON, create a user-friendly message
        let errorMessage = "An error occurred";

        if (response.status === 401) {
          errorMessage = isAuthEndpoint ? "Invalid email or password" : "Session expired";
        } else if (response.status === 403) {
          errorMessage = "You don't have permission to access this resource";
        } else if (response.status === 404) {
          errorMessage = "The requested resource was not found";
        } else if (response.status === 429) {
          errorMessage = "Too many requests, please try again later";
        } else if (response.status >= 500) {
          errorMessage = "Server error, please try again later";
        }

        throw new Error(errorMessage);
      }
    }
    
    // Handle empty responses (like 204 No Content)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const text = await response.text();
      return text ? JSON.parse(text) as T : {} as T;
    }
    
    return {} as T;
  } catch (error) {
    console.error(`Directus API error (${endpoint}):`, error);
    throw error;
  }
}

/**
 * Server functions for Directus API
 */
export const directusServer = {
  /**
   * Authenticate user with email and password
   */
  async login(email: string, password: string) {
    return directusRequest<{ data: { access_token: string; refresh_token: string } }>(
      "/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }
    );
  },
  
  /**
   * Request password reset
   */
  async requestPasswordReset(email: string, resetUrl: string) {
    console.log(`Sending password reset request for ${email} with reset URL: ${resetUrl}`);
    
    // This endpoint may return a 204 No Content with no response body
    return directusRequest<{ data?: object }>(
      "/auth/password/request",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reset_url: resetUrl }),
      }
    );
  },
  
  /**
   * Reset password with token
   */
  async resetPassword(token: string, password: string) {
    return directusRequest<{ data: object }>(
      "/auth/password/reset",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      }
    );
  },
  
  /**
   * Get current user data
   */
  async getCurrentUser(token: string) {
    return directusRequest<{ data: any }>(
      "/users/me",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string) {
    return directusRequest<{ data: { access_token: string; refresh_token: string } }>(
      "/auth/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );
  },
  
  /**
   * Get all food trucks
   */
  async getFoodTrucks(token: string) {
    return directusRequest<{ data: any[] }>(
      "/items/foodtrucks",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Get food truck by ID
   */
  async getFoodTruck(id: string, token: string) {
    return directusRequest<{ data: any }>(
      `/items/foodtrucks/${id}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Get food truck by user ID
   */
  async getFoodTruckByUser(token: string) {
    return directusRequest<{ data: any[] }>(
      `/items/foodtrucks?filter[user][_eq]=$CURRENT_USER`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Update food truck information
   */
  async updateFoodTruck(id: string, data: any, token: string) {
    return directusRequest<{ data: any }>(
      `/items/foodtrucks/${id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      }
    );
  },
  
  /**
   * Upload file to Directus
   */
  async uploadFile(formData: FormData, token: string) {
    // Special case for file uploads - we need to use FormData
    const url = `${DIRECTUS_URL}/files`;
    
    try {
      console.log(`Uploading file to: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          // Note: Don't set Content-Type header for FormData
        },
        body: formData,
      });
      
      if (!response.ok) {
        try {
          const errorData = await response.json() as DirectusErrorResponse;
          throw new Error(
            errorData.errors?.[0]?.message || 
            `Directus request failed with status ${response.status}`
          );
        } catch (jsonError) {
          throw new Error(`File upload failed with status ${response.status}`);
        }
      }
      
      return response.json();
    } catch (error) {
      console.error(`File upload error:`, error);
      throw error;
    }
  },
  
  /**
   * Get all spaces
   */
  async getSpaces(token: string) {
    return directusRequest<{ data: any[] }>(
      "/items/spaces?fields=*,time_slots.*",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Get all spaces with their bookings for a date range
   */
  async getSpacesWithBookings(startDate: string, endDate: string, token: string) {
    const encodedStartDate = encodeURIComponent(startDate);
    const encodedEndDate = encodeURIComponent(endDate);
    
    return directusRequest<{ data: any[] }>(
      `/items/spaces?fields=*,bookings.*,bookings.foodtruck.*&filter[bookings][start][_between]=[${encodedStartDate},${encodedEndDate}]`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Get space by ID
   */
  async getSpace(id: string, token: string) {
    return directusRequest<{ data: any }>(
      `/items/spaces/${id}?fields=*,time_slots.*`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Get all bookings
   */
  async getBookings(token: string) {
    return directusRequest<{ data: any[] }>(
      "/items/foodtruck_bookings",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Get all bookings for a date range
   */
  async getBookingsForDateRange(startDate: string, endDate: string, token: string) {
    const encodedStartDate = encodeURIComponent(startDate);
    const encodedEndDate = encodeURIComponent(endDate);
    
    return directusRequest<{ data: any[] }>(
      `/items/foodtruck_bookings?filter[start][_between]=[${encodedStartDate},${encodedEndDate}]&fields=*,space.*,foodtruck.*&sort=start&limit=-1`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Get bookings for a specific food truck
   */
  async getFoodTruckBookings(foodTruckId: string, token: string) {
    return directusRequest<{ data: any[] }>(
      `/items/foodtruck_bookings?filter[foodtruck][_eq]=${foodTruckId}&sort=start&fields=*,space.*,foodtruck.*`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Get booking rules
   */
  async getBookingRules(token: string) {
    return directusRequest<{ data: any }>(
      "/items/foodtruck_rules",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
  
  /**
   * Check for overlapping bookings on the same space and time period
   */
  async checkOverlappingBookings(
    spaceId: string | number,
    start: string,
    end: string,
    token: string
  ): Promise<{ data: any[] }> {
    const encodedStart = encodeURIComponent(start);
    const encodedEnd = encodeURIComponent(end);

    // Find bookings for the same space where the time overlaps:
    // A booking overlaps if it starts before our end AND ends after our start
    return directusRequest<{ data: any[] }>(
      `/items/foodtruck_bookings?filter[space][_eq]=${spaceId}&filter[start][_lt]=${encodedEnd}&filter[end][_gt]=${encodedStart}&fields=id,foodtruck.name,start,end`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  /**
   * Create a new booking
   */
  async createBooking(bookingData: {
    foodtruck: string | number;
    space: string | number;
    start: string;
    end: string;
  }, token: string) {
    return directusRequest<{ data: any }>(
      "/items/foodtruck_bookings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(bookingData),
      }
    );
  },
  
  /**
   * Update a booking
   */
  async updateBooking(
    id: string,
    bookingData: Partial<{
      foodtruck: string | number;
      space: string | number;
      start: string;
      end: string;
    }>,
    token: string
  ) {
    return directusRequest<{ data: any }>(
      `/items/foodtruck_bookings/${id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(bookingData),
      }
    );
  },
  
  /**
   * Delete a booking
   */
  async deleteBooking(id: string, token: string) {
    return directusRequest<void>(
      `/items/foodtruck_bookings/${id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  // ============================================
  // Admin functions (Head of Foodtruck)
  // ============================================

  /**
   * Get current user with role information
   */
  async getCurrentUserWithRole(token: string) {
    return directusRequest<{ data: { id: string; email: string; first_name: string; last_name: string; role: { id: string; name: string } } }>(
      "/users/me?fields=id,email,first_name,last_name,role.id,role.name",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  /**
   * Get all food trucks with user information (for admin)
   */
  async getAllFoodTrucksWithUsers(token: string) {
    return directusRequest<{ data: any[] }>(
      "/items/foodtrucks?fields=*,user.id,user.email,user.first_name,user.last_name,bookings.id",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  /**
   * Toggle food truck active status
   */
  async setFoodTruckActive(id: string, active: boolean, token: string) {
    return directusRequest<{ data: any }>(
      `/items/foodtrucks/${id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active }),
      }
    );
  },

  /**
   * Delete a food truck
   */
  async deleteFoodTruck(id: string, token: string) {
    return directusRequest<void>(
      `/items/foodtrucks/${id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  /**
   * Get blocked dates for spaces
   */
  async getSpaceBlockedDates(token: string) {
    return directusRequest<{ data: any[] }>(
      "/items/space_blocked_dates?fields=*,space.id,space.name&filter[status][_neq]=archived&sort=date",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  /**
   * Check if a space is blocked for a specific date and time slot
   */
  async isSpaceBlocked(spaceId: string, date: string, timeSlot: "morning" | "evening", token: string) {
    // Get blocked dates for this space on this date
    const response = await directusRequest<{ data: any[] }>(
      `/items/space_blocked_dates?fields=*&filter[space][_eq]=${spaceId}&filter[date][_eq]=${date}&filter[status][_neq]=archived`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // Check if any blocked date matches the time slot
    for (const blocked of response.data) {
      if (blocked.time_slot === "all_day") {
        return { blocked: true, reason: blocked.reason };
      }
      if (blocked.time_slot === timeSlot) {
        return { blocked: true, reason: blocked.reason };
      }
    }

    return { blocked: false };
  },

  /**
   * Create a blocked date for a space
   */
  async createSpaceBlockedDate(data: {
    space: number;
    date: string;
    time_slot: "morning" | "evening" | "all_day";
    reason?: string;
  }, token: string) {
    return directusRequest<{ data: any }>(
      "/items/space_blocked_dates",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...data, status: "published" }),
      }
    );
  },

  /**
   * Delete a blocked date
   */
  async deleteSpaceBlockedDate(id: string, token: string) {
    return directusRequest<void>(
      `/items/space_blocked_dates/${id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  /**
   * Update booking rules (including guidelines_url)
   */
  async updateBookingRules(data: {
    maximum_future_bookings?: number;
    maximum_days_ahead?: number;
    last_minute_booking_hours?: number;
    guidelines_url?: string;
  }, token: string) {
    return directusRequest<{ data: any }>(
      "/items/foodtruck_rules",
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      }
    );
  },

  /**
   * Get users without a food truck (for creating new food trucks)
   */
  async getUsersWithoutFoodTruck(token: string) {
    // First get all food truck user IDs
    const foodTrucks = await directusRequest<{ data: { user: string }[] }>(
      "/items/foodtrucks?fields=user",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const usedUserIds = foodTrucks.data.map(ft => ft.user).filter(Boolean);

    // Get all users with the Foodtrucker role
    const foodtruckerRoleId = "678efff4-6582-41a5-8b5d-e197dac5ae73";

    let url = `/users?fields=id,email,first_name,last_name&filter[role][_eq]=${foodtruckerRoleId}`;

    // Exclude users who already have a food truck
    if (usedUserIds.length > 0) {
      url += `&filter[id][_nin]=${usedUserIds.join(",")}`;
    }

    return directusRequest<{ data: any[] }>(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
  },

  /**
   * Create a new user with Foodtrucker role
   */
  async createFoodTruckUser(data: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
  }, token: string) {
    const foodtruckerRoleId = "678efff4-6582-41a5-8b5d-e197dac5ae73";

    return directusRequest<{ data: any }>(
      "/users",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...data,
          role: foodtruckerRoleId,
        }),
      }
    );
  },

  /**
   * Create a new food truck
   */
  async createFoodTruck(data: {
    name: string;
    description?: string;
    user: string;
    active?: boolean;
  }, token: string) {
    return directusRequest<{ data: any }>(
      "/items/foodtrucks",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...data,
          active: data.active ?? true,
        }),
      }
    );
  },

  /**
   * Delete a user (only Foodtrucker role users)
   */
  async deleteFoodTruckUser(userId: string, token: string) {
    const foodtruckerRoleId = "678efff4-6582-41a5-8b5d-e197dac5ae73";

    // First verify the user has Foodtrucker role (safety check)
    const user = await directusRequest<{ data: { role: string } }>(
      `/users/${userId}?fields=role`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (user.data.role !== foodtruckerRoleId) {
      throw new Error("Kan endast ta bort användare med Foodtrucker-rollen");
    }

    return directusRequest<void>(
      `/users/${userId}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  // ============================================
  // Documents functions
  // ============================================

  /**
   * Get all documents (for regular users - only published)
   */
  async getDocuments(token: string) {
    return directusRequest<{ data: any[] }>(
      "/items/documents?fields=*,file.*&filter[status][_eq]=published&sort=sort",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  /**
   * Get all documents for admin (including drafts)
   */
  async getDocumentsAdmin(token: string) {
    return directusRequest<{ data: any[] }>(
      "/items/documents?fields=*,file.*&filter[status][_neq]=archived&sort=sort",
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },

  /**
   * Create a document
   */
  async createDocument(data: {
    title: string;
    description?: string;
    link_type: 'url' | 'file';
    url?: string;
    file?: string;
    status?: string;
  }, token: string) {
    return directusRequest<{ data: any }>(
      "/items/documents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...data,
          status: data.status || 'published'
        }),
      }
    );
  },

  /**
   * Update a document
   */
  async updateDocument(id: string, data: {
    title?: string;
    description?: string;
    link_type?: 'url' | 'file';
    url?: string;
    file?: string;
    status?: string;
    sort?: number;
  }, token: string) {
    return directusRequest<{ data: any }>(
      `/items/documents/${id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      }
    );
  },

  /**
   * Delete a document
   */
  async deleteDocument(id: string, token: string) {
    return directusRequest<void>(
      `/items/documents/${id}`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
};