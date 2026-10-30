"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  // Shown once Directus says the account has 2FA (INVALID_OTP without a code)
  const [otp, setOtp] = useState("")
  const [needsOtp, setNeedsOtp] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()
  const { login, user, logout, isAuthenticated } = useAuth()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    console.log("Login attempt with email:", email)

    try {
      await login(email, password, needsOtp ? otp : undefined)
      
      // Check if there's a saved redirect path
      let redirectPath = "/dashboard"
      if (typeof window !== 'undefined') {
        const savedPath = sessionStorage.getItem('redirectAfterLogin')
        if (savedPath) {
          redirectPath = savedPath
          // Clear the saved path
          sessionStorage.removeItem('redirectAfterLogin')
        }
      }
      
      // Redirect to saved path or dashboard
      router.push(redirectPath)
    } catch (err) {
      console.error("Login error:", err)
      const code = (err as { code?: string })?.code
      if (code === "otp_required" || code === "invalid_otp") {
        setNeedsOtp(true)
        setOtp("")
      }
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  function handleForgotPassword() {
    router.push("/auth/password-request")
  }

  function handleLogout() {
    logout()
  }

  // If user is authenticated, show user information instead of login form
  if (isAuthenticated && user) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">Welcome!</h1>
          <p className="text-muted-foreground text-sm text-balance">
            You are logged in as {user.email}
          </p>
        </div>
        
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div>
                <span className="font-medium">Email:</span> {user.email}
              </div>
              {user.first_name && (
                <div>
                  <span className="font-medium">First Name:</span> {user.first_name}
                </div>
              )}
              {user.last_name && (
                <div>
                  <span className="font-medium">Last Name:</span> {user.last_name}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Button variant="outline" onClick={handleLogout} className="w-full">
          Logout
        </Button>
      </div>
    )
  }

  return (
    <form 
      className={cn("flex flex-col gap-6", className)} 
      onSubmit={handleSubmit}
      {...props}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-bold">Login to your account</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Enter your email below to login to your account
        </p>
      </div>
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          {error}
        </div>
      )}
      <div className="grid gap-6">
        <div className="grid gap-3">
          <Label htmlFor="email">Email</Label>
          <Input 
            id="email" 
            type="email" 
            placeholder="m@example.com" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required 
          />
        </div>
        <div className="grid gap-3">
          <div className="flex items-center">
            <Label htmlFor="password">Password</Label>
            <button
              type="button"
              onClick={handleForgotPassword}
              className="ml-auto text-sm underline-offset-4 hover:underline"
            >
              Forgot your password?
            </button>
          </div>
          <Input 
            id="password" 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required 
          />
        </div>
        {needsOtp && (
          <div className="grid gap-3">
            <Label htmlFor="otp">Kod från autentiseringsappen</Label>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              autoFocus
              required
            />
          </div>
        )}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Logging in..." : "Login"}
        </Button>
      </div>
    </form>
  )
}