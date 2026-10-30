"use client"

import { createContext, useContext, useEffect, useState, ReactNode } from "react"
import { useRouter } from "next/navigation"
import { login as loginAction, getCurrentUserWithRole, refreshToken as refreshTokenAction, logout as logoutAction } from "@/app/actions"

interface User {
  id: string
  email: string
  first_name?: string
  last_name?: string
  role?: {
    id: string
    name: string
  }
  isAdmin?: boolean
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  login: (email: string, password: string, otp?: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    // Check if user is logged in on page load
    const checkAuth = async () => {
      try {
        setIsLoading(true)
        const result = await getCurrentUserWithRole()

        if (result.success && result.data) {
          setUser(result.data)
        } else {
          // Try to refresh token
          await tryRefreshToken()
        }
      } catch (error) {
        console.error("Auth check error:", error)
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [])

  const tryRefreshToken = async () => {
    try {
      const result = await refreshTokenAction()

      if (result.success) {
        // Get user data with new token
        const userResult = await getCurrentUserWithRole()

        if (userResult.success && userResult.data) {
          setUser(userResult.data)
        } else {
          setUser(null)
        }
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error("Token refresh error:", error)
      setUser(null)
    }
  }

  const login = async (email: string, password: string, otp?: string) => {
    setIsLoading(true)

    try {
      const result = await loginAction(email, password, otp)

      if (!result.success) {
        // Keep the server's code so the form can ask for a 2FA code
        throw Object.assign(new Error(result.error || "Login failed"), { code: result.code })
      }

      // Get user data with role
      const userResult = await getCurrentUserWithRole()

      if (userResult.success && userResult.data) {
        setUser(userResult.data)
        // We'll handle redirect in the login form
      } else {
        throw new Error(userResult.error || "Failed to get user data")
      }
    } catch (error) {
      console.error("Login error:", error)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  const logout = async () => {
    try {
      await logoutAction()
      setUser(null)
      // No need to redirect since we're already on the login page
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isAdmin: !!user?.isAdmin,
        login,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  
  return context
}