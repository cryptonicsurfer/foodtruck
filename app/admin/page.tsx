"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { ProtectedRoute } from "@/components/protected-route"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Users, CalendarOff, Settings, Trash2, Power, PowerOff, Plus, ExternalLink, UserPlus, Pencil, FileText, Link, Upload, ClipboardList, MapPin, Sun, Moon, Soup, Calendar } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { MultiDateCalendar, type CalendarBooking } from "@/components/multi-date-calendar"
import { SpaceDialog } from "@/components/space-dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { cn } from "@/lib/utils"
import { format, startOfMonth, addMonths } from "date-fns"
import { sv } from "date-fns/locale"
import {
  adminGetAllFoodTrucks,
  adminSetFoodTruckActive,
  adminDeleteFoodTruck,
  adminUpdateFoodTruck,
  adminGetSpaceBlockedDates,
  adminCreateSpaceBlockedDate,
  adminDeleteSpace,
  adminUpdateBookingRules,
  adminDeleteSpaceBlockedDate,
  adminGetUsersWithoutFoodTruck,
  adminCreateFoodTruckUser,
  adminCreateFoodTruck,
  adminGetDocuments,
  adminCreateDocument,
  adminDeleteDocument,
  getBookingRules,
  getAllSpaces,
  getBookingsForDateRange
} from "@/app/actions"

interface FoodTruck {
  id: number
  name: string
  description?: string
  image?: string
  active: boolean
  user?: {
    id: string
    email: string
    first_name?: string
    last_name?: string
  }
  bookings?: { id: number }[]
}

interface BlockedDate {
  id: number
  date: string
  time_slot: "morning" | "evening" | "all_day"
  reason?: string
  space?: {
    id: number
    name: string
  }
}

interface Space {
  id: number
  name: string
  description?: string | null
  location?: { type?: string; coordinates?: [number, number] } | null
  time_slots?: Array<{ start: string; end: string; description?: string }> | null
  bookable_from?: string | null
  bookable_to?: string | null
}

interface AvailableUser {
  id: string
  email: string
  first_name?: string
  last_name?: string
}

interface BookingRules {
  id: number
  maximum_future_bookings: number
  maximum_days_ahead: number
  last_minute_booking_hours: number
  guidelines_url?: string
}

interface Document {
  id: number
  title: string
  description?: string
  link_type: 'url' | 'file'
  url?: string
  file?: {
    id: string
    filename_download: string
  }
  status: string
  sort?: number
}

const DIRECTUS_URL = process.env.NEXT_PUBLIC_DIRECTUS_URL || "https://cms.businessfalkenberg.se"

export default function AdminPage() {
  const { isAdmin, isLoading: authLoading } = useAuth()
  const router = useRouter()

  const [foodTrucks, setFoodTrucks] = useState<FoodTruck[]>([])
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([])
  const [spaces, setSpaces] = useState<Space[]>([])
  const [bookingRules, setBookingRules] = useState<BookingRules | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Schedule (parking-officer overview) state
  const [scheduleBookings, setScheduleBookings] = useState<any[]>([])
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleLoaded, setScheduleLoaded] = useState(false)
  const [scheduleFrom, setScheduleFrom] = useState(format(new Date(), "yyyy-MM-dd"))
  const [scheduleTo, setScheduleTo] = useState("")
  const [scheduleSpace, setScheduleSpace] = useState("")
  // Booking selected in the schedule → opens the foodtruck preview dialog
  const [scheduleDetail, setScheduleDetail] = useState<
    { date: string; space: string; slot: "morning" | "evening"; foodtruckId: string; foodtruckName: string } | null
  >(null)
  // Space management (create/edit dialog + delete confirm)
  const [spaceDialog, setSpaceDialog] = useState<{ open: boolean; space: Space | null }>({ open: false, space: null })
  const [deleteSpaceDialog, setDeleteSpaceDialog] = useState<{ open: boolean; space: Space | null }>({ open: false, space: null })
  const [deletingSpace, setDeletingSpace] = useState(false)

  // Booking-rules editing
  const [rulesEdit, setRulesEdit] = useState({ maximum_future_bookings: "", maximum_days_ahead: "", last_minute_booking_hours: "" })
  const [rulesConfirm, setRulesConfirm] = useState(false)
  const [savingRules, setSavingRules] = useState(false)

  // Document dialog states
  const [addDocumentDialog, setAddDocumentDialog] = useState(false)
  const [newDocument, setNewDocument] = useState({ title: "", description: "", link_type: "url" as const, url: "" })
  const [creatingDocument, setCreatingDocument] = useState(false)

  // Dialog states
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; truck: FoodTruck | null; deleteUser: boolean }>({ open: false, truck: null, deleteUser: true })
  const [editDialog, setEditDialog] = useState<{ open: boolean; truck: FoodTruck | null }>({ open: false, truck: null })
  const [editTruck, setEditTruck] = useState({ name: "", description: "" })
  const [savingEdit, setSavingEdit] = useState(false)
  const [blockDateDialog, setBlockDateDialog] = useState(false)
  const [newBlockedDate, setNewBlockedDate] = useState({ space: "", date: "", time_slot: "all_day" as const, reason: "" })
  const [blockMode, setBlockMode] = useState<"day" | "period">("day")
  const [periodDates, setPeriodDates] = useState<string[]>([])
  const [savingBlock, setSavingBlock] = useState(false)
  const [periodBookings, setPeriodBookings] = useState<any[]>([])

  // Add food truck dialog state
  const [addTruckDialog, setAddTruckDialog] = useState(false)
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([])
  const [createNewUser, setCreateNewUser] = useState(false)
  const [newTruck, setNewTruck] = useState({
    name: "",
    description: "",
    userId: "",
    // New user fields
    userEmail: "",
    userPassword: "",
    userFirstName: "",
    userLastName: ""
  })
  const [creatingTruck, setCreatingTruck] = useState(false)

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push("/dashboard")
    }
  }, [authLoading, isAdmin, router])

  useEffect(() => {
    if (isAdmin) {
      loadData()
    }
  }, [isAdmin])

  const loadData = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [trucksRes, blockedRes, spacesRes, rulesRes, docsRes] = await Promise.all([
        adminGetAllFoodTrucks(),
        adminGetSpaceBlockedDates(),
        getAllSpaces(),
        getBookingRules(),
        adminGetDocuments()
      ])

      if (trucksRes.success) setFoodTrucks(trucksRes.data || [])
      if (blockedRes.success) setBlockedDates(blockedRes.data || [])
      if (spacesRes.success) setSpaces(spacesRes.data || [])
      if (rulesRes.success) setBookingRules(rulesRes.data)
      if (docsRes.success) setDocuments(docsRes.data || [])
    } catch (err) {
      setError("Failed to load data")
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  // Lazy-load the schedule (bookings today → +12 months) the first time the tab opens
  const loadSchedule = async (force = false) => {
    if (scheduleLoaded && !force) return
    setScheduleLoading(true)
    const start = startOfMonth(new Date())
    const end = addMonths(start, 12)
    const res = await getBookingsForDateRange(start.toISOString(), end.toISOString())
    if (res.success) {
      setScheduleBookings(res.data || [])
      setScheduleLoaded(true)
    }
    setScheduleLoading(false)
  }

  const handleToggleActive = async (truck: FoodTruck) => {
    const result = await adminSetFoodTruckActive(String(truck.id), !truck.active)
    if (result.success) {
      setFoodTrucks(prev => prev.map(t => t.id === truck.id ? { ...t, active: !t.active } : t))
    }
  }

  const handleDeleteTruck = async () => {
    if (!deleteDialog.truck) return

    const result = await adminDeleteFoodTruck(
      String(deleteDialog.truck.id),
      deleteDialog.deleteUser,
      deleteDialog.truck.user?.id
    )
    if (result.success) {
      setFoodTrucks(prev => prev.filter(t => t.id !== deleteDialog.truck?.id))
      setDeleteDialog({ open: false, truck: null, deleteUser: true })
    }
  }

  const handleOpenEditDialog = (truck: FoodTruck) => {
    setEditTruck({ name: truck.name, description: truck.description || "" })
    setEditDialog({ open: true, truck })
  }

  const handleUpdateTruck = async () => {
    if (!editDialog.truck) return

    setSavingEdit(true)
    const result = await adminUpdateFoodTruck(String(editDialog.truck.id), {
      name: editTruck.name,
      description: editTruck.description || undefined
    })

    if (result.success) {
      setFoodTrucks(prev => prev.map(t =>
        t.id === editDialog.truck?.id
          ? { ...t, name: editTruck.name, description: editTruck.description }
          : t
      ))
      setEditDialog({ open: false, truck: null })
    } else {
      setError(result.error || "Kunde inte uppdatera foodtruck")
    }
    setSavingEdit(false)
  }

  const handleCreateBlockedDate = async () => {
    if (!newBlockedDate.space || !newBlockedDate.date) return

    const result = await adminCreateSpaceBlockedDate({
      space: parseInt(newBlockedDate.space),
      date: newBlockedDate.date,
      time_slot: newBlockedDate.time_slot,
      reason: newBlockedDate.reason || undefined
    })

    if (result.success) {
      await loadData()
      setBlockDateDialog(false)
      setNewBlockedDate({ space: "", date: "", time_slot: "all_day", reason: "" })
    }
  }

  const handleCreateBlockedPeriod = async () => {
    if (!newBlockedDate.space || periodDates.length === 0) return

    setSavingBlock(true)
    let hadError = false
    for (const date of periodDates) {
      const result = await adminCreateSpaceBlockedDate({
        space: parseInt(newBlockedDate.space),
        date,
        time_slot: newBlockedDate.time_slot,
        reason: newBlockedDate.reason || undefined
      })
      if (!result.success) hadError = true
    }
    setSavingBlock(false)

    await loadData()
    if (!hadError) {
      closeBlockDialog()
    }
  }

  const closeBlockDialog = () => {
    setBlockDateDialog(false)
    setBlockMode("day")
    setPeriodDates([])
    setPeriodBookings([])
    setNewBlockedDate({ space: "", date: "", time_slot: "all_day", reason: "" })
  }

  // Load bookings (wide window) once the period dialog is open and a space is chosen,
  // so the calendar can flag days that already have bookings.
  useEffect(() => {
    if (!blockDateDialog || blockMode !== "period" || !newBlockedDate.space) {
      return
    }
    let cancelled = false
    const start = startOfMonth(new Date())
    const end = addMonths(start, 18)
    getBookingsForDateRange(start.toISOString(), end.toISOString()).then((res) => {
      if (!cancelled && res.success) {
        setPeriodBookings(res.data || [])
      }
    })
    return () => { cancelled = true }
  }, [blockDateDialog, blockMode, newBlockedDate.space])

  // Seed the booking-rules editor from loaded rules
  useEffect(() => {
    if (!bookingRules) return
    setRulesEdit({
      maximum_future_bookings: String(bookingRules.maximum_future_bookings ?? ""),
      maximum_days_ahead: String(bookingRules.maximum_days_ahead ?? ""),
      last_minute_booking_hours: String(bookingRules.last_minute_booking_hours ?? ""),
    })
  }, [bookingRules])

  const handleDeleteSpace = async () => {
    if (!deleteSpaceDialog.space) return
    setDeletingSpace(true)
    const result = await adminDeleteSpace(String(deleteSpaceDialog.space.id))
    setDeletingSpace(false)
    if (result.success) {
      setSpaces(prev => prev.filter(s => s.id !== deleteSpaceDialog.space?.id))
      setDeleteSpaceDialog({ open: false, space: null })
    } else {
      setError(result.error || "Kunde inte ta bort platsen")
      setDeleteSpaceDialog({ open: false, space: null })
    }
  }

  const rulesDirty = bookingRules ? (
    rulesEdit.maximum_future_bookings !== String(bookingRules.maximum_future_bookings ?? "") ||
    rulesEdit.maximum_days_ahead !== String(bookingRules.maximum_days_ahead ?? "") ||
    rulesEdit.last_minute_booking_hours !== String(bookingRules.last_minute_booking_hours ?? "")
  ) : false

  const handleSaveRules = async () => {
    setSavingRules(true)
    const result = await adminUpdateBookingRules({
      maximum_future_bookings: Number(rulesEdit.maximum_future_bookings),
      maximum_days_ahead: Number(rulesEdit.maximum_days_ahead),
      last_minute_booking_hours: Number(rulesEdit.last_minute_booking_hours),
    })
    setSavingRules(false)
    setRulesConfirm(false)
    if (result.success) {
      setBookingRules(prev => prev ? {
        ...prev,
        maximum_future_bookings: Number(rulesEdit.maximum_future_bookings),
        maximum_days_ahead: Number(rulesEdit.maximum_days_ahead),
        last_minute_booking_hours: Number(rulesEdit.last_minute_booking_hours),
      } : prev)
      setError(null)
    } else {
      setError(result.error || "Kunde inte spara bokningsregler")
    }
  }

  // Bookings for the chosen space, keyed by "yyyy-MM-dd" → [{ foodtruck, space }]
  const periodBookingsByDate = (() => {
    const map: Record<string, CalendarBooking[]> = {}
    if (!newBlockedDate.space) return map
    for (const b of periodBookings) {
      if (String(b.space?.id ?? b.space) !== newBlockedDate.space) continue
      if (!b.start) continue
      const key = format(new Date(b.start), "yyyy-MM-dd")
      ;(map[key] ||= []).push({
        foodtruck: b.foodtruck?.name ?? "Okänd foodtruck",
        space: b.space?.name ?? "Okänd plats",
      })
    }
    return map
  })()

  // Dates already blocked for the chosen space + slot (all_day always counts) — shown as disabled in the calendar
  const alreadyBlockedForSelection = (() => {
    if (!newBlockedDate.space) return [] as string[]
    return blockedDates
      .filter((d: any) =>
        String(d.space?.id ?? d.space) === newBlockedDate.space &&
        (d.time_slot === "all_day" ||
          newBlockedDate.time_slot === "all_day" ||
          d.time_slot === newBlockedDate.time_slot)
      )
      .map((d: any) => d.date)
  })()

  // Parse date/hour straight from the stored string (e.g. "2026-06-29T10:00:00") so we never
  // shift across midnight via the local timezone — same approach as createBooking() in actions.ts.
  const dateOf = (start: string): string => start.slice(0, 10)
  // morning: starts before 16:00, evening: 16:00 onwards (matches available-slots-dialog)
  const slotOf = (start: string): "morning" | "evening" =>
    parseInt(start.slice(11, 13), 10) < 16 ? "morning" : "evening"

  // Full food-truck info (image, owner, description) keyed by id — reused for the schedule thumbnails/preview
  const foodTruckById = (() => {
    const map: Record<string, FoodTruck> = {}
    for (const t of foodTrucks) map[String(t.id)] = t
    return map
  })()

  // Schedule grouped by date → sorted by space → sorted by slot, honoring the from/to/space filters.
  const scheduleByDate = (() => {
    const groups: Record<string, { foodtruck: string; foodtruckId: string; space: string; slot: "morning" | "evening"; start: string }[]> = {}
    for (const b of scheduleBookings) {
      if (!b.start) continue
      const dateKey = dateOf(b.start)
      if (scheduleFrom && dateKey < scheduleFrom) continue
      if (scheduleTo && dateKey > scheduleTo) continue
      const spaceId = String(b.space?.id ?? b.space ?? "")
      if (scheduleSpace && spaceId !== scheduleSpace) continue
      ;(groups[dateKey] ||= []).push({
        foodtruck: b.foodtruck?.name ?? "Okänd foodtruck",
        foodtruckId: String(b.foodtruck?.id ?? b.foodtruck ?? ""),
        space: b.space?.name ?? "Okänd plats",
        slot: slotOf(b.start),
        start: b.start,
      })
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({
        date,
        items: items.sort(
          (a, b) => a.space.localeCompare(b.space, "sv") || a.slot.localeCompare(b.slot)
        ),
      }))
  })()

  const handleDeleteBlockedDate = async (id: number) => {
    const result = await adminDeleteSpaceBlockedDate(String(id))
    if (result.success) {
      setBlockedDates(prev => prev.filter(d => d.id !== id))
    }
  }

  const handleCreateDocument = async () => {
    if (!newDocument.title || !newDocument.url) return

    setCreatingDocument(true)
    const result = await adminCreateDocument({
      title: newDocument.title,
      description: newDocument.description || undefined,
      link_type: newDocument.link_type,
      url: newDocument.url
    })

    if (result.success) {
      await loadData()
      setAddDocumentDialog(false)
      setNewDocument({ title: "", description: "", link_type: "url", url: "" })
    } else {
      setError(result.error || "Kunde inte skapa dokument")
    }
    setCreatingDocument(false)
  }

  const handleDeleteDocument = async (id: number) => {
    const result = await adminDeleteDocument(String(id))
    if (result.success) {
      setDocuments(prev => prev.filter(d => d.id !== id))
    }
  }

  const handleOpenAddTruckDialog = async () => {
    setAddTruckDialog(true)
    // Load available users
    const result = await adminGetUsersWithoutFoodTruck()
    if (result.success) {
      setAvailableUsers(result.data || [])
    }
  }

  const handleCreateFoodTruck = async () => {
    if (!newTruck.name) return

    setCreatingTruck(true)
    try {
      let userId = newTruck.userId

      // If creating a new user
      if (createNewUser) {
        if (!newTruck.userEmail || !newTruck.userPassword || !newTruck.userFirstName || !newTruck.userLastName) {
          setError("Fyll i alla användarfält")
          setCreatingTruck(false)
          return
        }

        const userResult = await adminCreateFoodTruckUser({
          email: newTruck.userEmail,
          password: newTruck.userPassword,
          first_name: newTruck.userFirstName,
          last_name: newTruck.userLastName
        })

        if (!userResult.success) {
          setError(userResult.error || "Kunde inte skapa användare")
          setCreatingTruck(false)
          return
        }

        userId = userResult.data.id
      }

      if (!userId) {
        setError("Välj en användare eller skapa en ny")
        setCreatingTruck(false)
        return
      }

      const result = await adminCreateFoodTruck({
        name: newTruck.name,
        description: newTruck.description || undefined,
        user: userId
      })

      if (result.success) {
        await loadData()
        setAddTruckDialog(false)
        setNewTruck({
          name: "",
          description: "",
          userId: "",
          userEmail: "",
          userPassword: "",
          userFirstName: "",
          userLastName: ""
        })
        setCreateNewUser(false)
        setError(null)
      } else {
        setError(result.error || "Kunde inte skapa foodtruck")
      }
    } catch (err) {
      setError("Ett fel uppstod")
      console.error(err)
    } finally {
      setCreatingTruck(false)
    }
  }

  const formatTimeSlot = (slot: string) => {
    switch (slot) {
      case "morning": return "Morgon/Lunch (06-15)"
      case "evening": return "Kväll (16-03)"
      case "all_day": return "Hela dagen"
      default: return slot
    }
  }

  if (authLoading || !isAdmin) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg">Laddar...</div>
      </div>
    )
  }

  return (
    <ProtectedRoute>
      <SidebarProvider>
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <main className="flex-1 p-4 md:p-6 overflow-auto">
            <div className="md:hidden mb-4">
              <CustomSidebarTrigger />
            </div>

            <div className="max-w-6xl mx-auto">
              <div className="mb-6">
                <h1 className="text-2xl font-bold">Administration</h1>
                <p className="text-muted-foreground">Hantera foodtrucks, platser och inställningar</p>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6">
                  {error}
                </div>
              )}

              <Tabs
                defaultValue="foodtrucks"
                className="space-y-4"
                onValueChange={(v) => { if (v === "schedule") loadSchedule() }}
              >
                <TabsList className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground w-full">
                  <TabsTrigger value="schedule" className="flex items-center gap-2 flex-1">
                    <ClipboardList size={16} />
                    <span className="hidden sm:inline">Schema</span>
                  </TabsTrigger>
                  <TabsTrigger value="foodtrucks" className="flex items-center gap-2 flex-1">
                    <Users size={16} />
                    <span className="hidden sm:inline">Aktörer</span>
                  </TabsTrigger>
                  <TabsTrigger value="blocked" className="flex items-center gap-2 flex-1">
                    <CalendarOff size={16} />
                    <span className="hidden sm:inline">Spärrade datum</span>
                  </TabsTrigger>
                  <TabsTrigger value="spaces" className="flex items-center gap-2 flex-1">
                    <MapPin size={16} />
                    <span className="hidden sm:inline">Platser</span>
                  </TabsTrigger>
                  <TabsTrigger value="documents" className="flex items-center gap-2 flex-1">
                    <FileText size={16} />
                    <span className="hidden sm:inline">Dokument</span>
                  </TabsTrigger>
                  <TabsTrigger value="settings" className="flex items-center gap-2 flex-1">
                    <Settings size={16} />
                    <span className="hidden sm:inline">Inställningar</span>
                  </TabsTrigger>
                </TabsList>

                {/* Schedule / parking-officer overview Tab */}
                <TabsContent value="schedule">
                  <Card>
                    <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle>Schema</CardTitle>
                        <CardDescription>
                          Vem som får stå var, per dag och plats. Sorterat på datum.
                        </CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => loadSchedule(true)}
                        disabled={scheduleLoading}
                      >
                        {scheduleLoading ? "Uppdaterar…" : "Uppdatera"}
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {/* Filters */}
                      <div className="grid gap-3 sm:grid-cols-3 mb-6">
                        <div className="space-y-1">
                          <Label htmlFor="scheduleFrom" className="text-xs">Från datum</Label>
                          <Input
                            id="scheduleFrom"
                            type="date"
                            value={scheduleFrom}
                            onChange={(e) => setScheduleFrom(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="scheduleTo" className="text-xs">Till datum (valfritt)</Label>
                          <Input
                            id="scheduleTo"
                            type="date"
                            value={scheduleTo}
                            onChange={(e) => setScheduleTo(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="scheduleSpace" className="text-xs">Plats</Label>
                          <select
                            id="scheduleSpace"
                            className="w-full border rounded-md p-2 h-10"
                            value={scheduleSpace}
                            onChange={(e) => setScheduleSpace(e.target.value)}
                          >
                            <option value="">Alla platser</option>
                            {spaces.map(space => (
                              <option key={space.id} value={space.id}>{space.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {scheduleLoading && !scheduleLoaded ? (
                        <div className="space-y-4">
                          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                        </div>
                      ) : scheduleByDate.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">
                          Inga bokningar i vald period
                        </p>
                      ) : (
                        <div className="space-y-6">
                          {scheduleByDate.map(({ date, items }) => (
                            <div key={date}>
                              <h3 className="font-semibold capitalize border-b pb-2 mb-3">
                                {format(new Date(`${date}T12:00:00`), "EEEE d MMMM yyyy", { locale: sv })}
                                <span className="ml-2 text-sm font-normal text-muted-foreground">
                                  {items.length} {items.length === 1 ? "bokning" : "bokningar"}
                                </span>
                              </h3>
                              <div className="space-y-2">
                                {items.map((item, idx) => {
                                  const truck = foodTruckById[item.foodtruckId]
                                  const image = truck?.image
                                  return (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => setScheduleDetail({
                                        date,
                                        space: item.space,
                                        slot: item.slot,
                                        foodtruckId: item.foodtruckId,
                                        foodtruckName: item.foodtruck,
                                      })}
                                      className="w-full flex items-center gap-3 p-3 rounded-lg border bg-white text-left transition-colors hover:bg-muted/60 active:bg-muted"
                                    >
                                      {image ? (
                                        <img
                                          src={`${DIRECTUS_URL}/assets/${image}?width=88&height=88&fit=cover`}
                                          alt=""
                                          className="h-11 w-11 rounded-md object-cover shrink-0 bg-muted"
                                          onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden" }}
                                        />
                                      ) : (
                                        <div className="h-11 w-11 rounded-md bg-muted flex items-center justify-center shrink-0">
                                          <Soup size={18} className="text-muted-foreground" />
                                        </div>
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <MapPin size={14} className="text-muted-foreground shrink-0" />
                                          <span className="font-medium truncate">{item.space}</span>
                                        </div>
                                        <p className="text-sm text-muted-foreground truncate">{item.foodtruck}</p>
                                      </div>
                                      <span
                                        className={cn(
                                          "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full shrink-0",
                                          item.slot === "morning"
                                            ? "bg-amber-100 text-amber-700"
                                            : "bg-indigo-100 text-indigo-700"
                                        )}
                                      >
                                        {item.slot === "morning" ? <Sun size={12} /> : <Moon size={12} />}
                                        <span className="hidden sm:inline">{item.slot === "morning" ? "Morgon/Lunch" : "Kväll"}</span>
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Food Trucks Tab */}
                <TabsContent value="foodtrucks">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle>Hantera aktörer</CardTitle>
                        <CardDescription>Aktivera, inaktivera eller ta bort foodtrucks</CardDescription>
                      </div>
                      <Button onClick={handleOpenAddTruckDialog} className="flex items-center gap-2">
                        <UserPlus size={16} />
                        <span className="hidden sm:inline">Lägg till</span>
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isLoading ? (
                        <div className="space-y-4">
                          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {foodTrucks.map(truck => (
                            <div
                              key={truck.id}
                              className={`flex items-center justify-between p-4 rounded-lg border ${
                                truck.active ? "bg-white" : "bg-gray-50 opacity-75"
                              }`}
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-medium">{truck.name}</h3>
                                  {!truck.active && (
                                    <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">
                                      Inaktiv
                                    </span>
                                  )}
                                </div>
                                {truck.user && (
                                  <p className="text-sm text-muted-foreground">
                                    {truck.user.first_name} {truck.user.last_name} ({truck.user.email})
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground mt-1">
                                  {truck.bookings?.length || 0} bokningar
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleOpenEditDialog(truck)}
                                >
                                  <Pencil size={16} />
                                  <span className="ml-1 hidden sm:inline">Redigera</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleToggleActive(truck)}
                                  className={truck.active ? "text-orange-600 hover:text-orange-700" : "text-green-600 hover:text-green-700"}
                                >
                                  {truck.active ? <PowerOff size={16} /> : <Power size={16} />}
                                  <span className="ml-1 hidden sm:inline">
                                    {truck.active ? "Inaktivera" : "Aktivera"}
                                  </span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setDeleteDialog({ open: true, truck, deleteUser: true })}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash2 size={16} />
                                  <span className="ml-1 hidden sm:inline">Ta bort</span>
                                </Button>
                              </div>
                            </div>
                          ))}
                          {foodTrucks.length === 0 && (
                            <p className="text-center text-muted-foreground py-8">Inga foodtrucks hittades</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Blocked Dates Tab */}
                <TabsContent value="blocked">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle>Spärrade datum</CardTitle>
                        <CardDescription>Blockera platser för specifika datum</CardDescription>
                      </div>
                      <Button onClick={() => setBlockDateDialog(true)} className="flex items-center gap-2">
                        <Plus size={16} />
                        <span className="hidden sm:inline">Spärra datum</span>
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isLoading ? (
                        <div className="space-y-4">
                          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {blockedDates.map(blocked => (
                            <div
                              key={blocked.id}
                              className="flex items-center justify-between p-4 rounded-lg border bg-red-50"
                            >
                              <div>
                                <h3 className="font-medium">{blocked.space?.name || "Okänd plats"}</h3>
                                <p className="text-sm text-muted-foreground">
                                  {new Date(blocked.date).toLocaleDateString("sv-SE")} - {formatTimeSlot(blocked.time_slot)}
                                </p>
                                {blocked.reason && (
                                  <p className="text-xs text-muted-foreground mt-1">{blocked.reason}</p>
                                )}
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteBlockedDate(blocked.id)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          ))}
                          {blockedDates.length === 0 && (
                            <p className="text-center text-muted-foreground py-8">Inga spärrade datum</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Spaces management Tab */}
                <TabsContent value="spaces">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle>Platser</CardTitle>
                        <CardDescription>Skapa, redigera och ta bort platser — namn, karta, tidsluckor och säsong.</CardDescription>
                      </div>
                      <Button onClick={() => setSpaceDialog({ open: true, space: null })} className="flex items-center gap-2">
                        <Plus size={16} />
                        <span className="hidden sm:inline">Skapa plats</span>
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isLoading ? (
                        <div className="space-y-4">
                          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {spaces.map(space => {
                            const hasCoord = Boolean(space.location?.coordinates)
                            const slotCount = space.time_slots?.length || 0
                            const from = space.bookable_from ? String(space.bookable_from).slice(0, 10).split("-").reverse().join("/") : ""
                            const to = space.bookable_to ? String(space.bookable_to).slice(0, 10).split("-").reverse().join("/") : ""
                            const season = from || to ? `Säsong ${from || "…"}–${to || "…"}` : "Alltid bokningsbar"
                            return (
                              <div key={space.id} className="flex items-center justify-between gap-3 p-4 rounded-lg border">
                                <div className="min-w-0">
                                  <h3 className="font-medium truncate">{space.name}</h3>
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
                                    <span className={cn("flex items-center gap-1", !hasCoord && "text-amber-600")}>
                                      <MapPin size={12} /> {hasCoord ? "Koordinat satt" : "Ingen koordinat"}
                                    </span>
                                    <span>{slotCount} {slotCount === 1 ? "tidslucka" : "tidsluckor"}</span>
                                    <span>{season}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Button variant="outline" size="sm" onClick={() => setSpaceDialog({ open: true, space })}>
                                    <Pencil size={16} />
                                    <span className="ml-1 hidden sm:inline">Redigera</span>
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-red-600 hover:text-red-700"
                                    onClick={() => setDeleteSpaceDialog({ open: true, space })}
                                  >
                                    <Trash2 size={16} />
                                  </Button>
                                </div>
                              </div>
                            )
                          })}
                          {spaces.length === 0 && (
                            <p className="text-center text-muted-foreground py-8">Inga platser hittades</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Documents Tab */}
                <TabsContent value="documents">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle>Dokument & Länkar</CardTitle>
                        <CardDescription>Hantera dokument och länkar som visas för foodtruck-användare</CardDescription>
                      </div>
                      <Button onClick={() => setAddDocumentDialog(true)}>
                        <Plus size={16} className="mr-2" />
                        Lägg till
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isLoading ? (
                        <div className="space-y-4">
                          <Skeleton className="h-16 w-full" />
                          <Skeleton className="h-16 w-full" />
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {documents.map((doc) => (
                            <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg">
                              <div className="flex items-start gap-3">
                                <div className="p-2 bg-primary/10 rounded-lg">
                                  {doc.link_type === 'file' ? (
                                    <Upload size={20} className="text-primary" />
                                  ) : (
                                    <Link size={20} className="text-primary" />
                                  )}
                                </div>
                                <div>
                                  <h4 className="font-medium">{doc.title}</h4>
                                  {doc.description && (
                                    <p className="text-sm text-muted-foreground">{doc.description}</p>
                                  )}
                                  <a
                                    href={doc.link_type === 'file' && doc.file
                                      ? `https://cms.businessfalkenberg.se/assets/${doc.file.id}`
                                      : doc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1"
                                  >
                                    <ExternalLink size={12} />
                                    {doc.link_type === 'file' ? doc.file?.filename_download : doc.url}
                                  </a>
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteDocument(doc.id)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          ))}
                          {documents.length === 0 && (
                            <p className="text-center text-muted-foreground py-8">
                              Inga dokument tillagda ännu
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Settings Tab */}
                <TabsContent value="settings">
                  <Card>
                    <CardHeader>
                      <CardTitle>Inställningar</CardTitle>
                      <CardDescription>Bokningsregler för systemet</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {isLoading ? (
                        <Skeleton className="h-32 w-full" />
                      ) : (
                        <div>
                          <h3 className="font-medium mb-4">Bokningsregler</h3>
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div className="space-y-1">
                              <Label htmlFor="rule-max" className="text-sm text-muted-foreground">Max framtida bokningar</Label>
                              <Input
                                id="rule-max"
                                type="number"
                                min={0}
                                value={rulesEdit.maximum_future_bookings}
                                onChange={(e) => setRulesEdit(prev => ({ ...prev, maximum_future_bookings: e.target.value }))}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="rule-days" className="text-sm text-muted-foreground">Max dagar framåt</Label>
                              <Input
                                id="rule-days"
                                type="number"
                                min={0}
                                value={rulesEdit.maximum_days_ahead}
                                onChange={(e) => setRulesEdit(prev => ({ ...prev, maximum_days_ahead: e.target.value }))}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="rule-lastminute" className="text-sm text-muted-foreground">Last-minute (timmar)</Label>
                              <Input
                                id="rule-lastminute"
                                type="number"
                                min={0}
                                value={rulesEdit.last_minute_booking_hours}
                                onChange={(e) => setRulesEdit(prev => ({ ...prev, last_minute_booking_hours: e.target.value }))}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-3 mt-4">
                            <Button onClick={() => setRulesConfirm(true)} disabled={!rulesDirty || savingRules}>
                              {savingRules ? "Sparar…" : "Spara"}
                            </Button>
                            <p className="text-xs text-muted-foreground">
                              Gäller alla foodtrucks. Last-minute = hur nära start en bokning får göras trots maxgränsen.
                            </p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </main>
        </div>

        {/* Delete Confirmation Dialog */}
        <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, truck: deleteDialog.truck, deleteUser: deleteDialog.deleteUser })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ta bort foodtruck</DialogTitle>
              <DialogDescription>
                Är du säker på att du vill ta bort &quot;{deleteDialog.truck?.name}&quot;? Detta går inte att ångra.
              </DialogDescription>
            </DialogHeader>
            {deleteDialog.truck?.user && (
              <div className="py-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="deleteUser"
                    checked={deleteDialog.deleteUser}
                    onChange={(e) => setDeleteDialog(prev => ({ ...prev, deleteUser: e.target.checked }))}
                    className="rounded"
                  />
                  <Label htmlFor="deleteUser" className="cursor-pointer">
                    Ta även bort användaren ({deleteDialog.truck.user.email})
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground mt-2 ml-6">
                  Om du bockar ur behålls användarkontot och kan kopplas till en ny foodtruck senare.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialog({ open: false, truck: null, deleteUser: true })}>
                Avbryt
              </Button>
              <Button variant="destructive" onClick={handleDeleteTruck}>
                Ta bort
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Food Truck Dialog */}
        <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog({ open, truck: editDialog.truck })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Redigera foodtruck</DialogTitle>
              <DialogDescription>
                Ändra namn och beskrivning för foodtrucken
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="editName">Namn *</Label>
                <Input
                  id="editName"
                  value={editTruck.name}
                  onChange={(e) => setEditTruck(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDescription">Beskrivning</Label>
                <Input
                  id="editDescription"
                  value={editTruck.description}
                  onChange={(e) => setEditTruck(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialog({ open: false, truck: null })}>
                Avbryt
              </Button>
              <Button onClick={handleUpdateTruck} disabled={savingEdit || !editTruck.name}>
                {savingEdit ? "Sparar..." : "Spara"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Block Date Dialog */}
        <Dialog open={blockDateDialog} onOpenChange={(open) => { if (!open) closeBlockDialog() }}>
          <DialogContent
            className={blockMode === "period" ? "sm:max-w-lg flex flex-col gap-4" : undefined}
            style={blockMode === "period" ? {
              top: "2.5vh",
              bottom: "2.5vh",
              maxHeight: "none",
              height: "auto",
              translate: "none",
              transform: "translateX(-50%)",
            } : undefined}
          >
            <DialogHeader>
              <DialogTitle>Spärra datum</DialogTitle>
              <DialogDescription>
                Välj plats och {blockMode === "period" ? "markera flera datum i kalendern" : "datum"} att spärra för bokningar
              </DialogDescription>
            </DialogHeader>

            {/* Toggle: single day vs period */}
            <div className="inline-flex rounded-md bg-muted p-1 text-muted-foreground w-full">
              <button
                type="button"
                onClick={() => setBlockMode("day")}
                className={cn(
                  "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                  blockMode === "day" ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"
                )}
              >
                Spärra dag
              </button>
              <button
                type="button"
                onClick={() => setBlockMode("period")}
                className={cn(
                  "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                  blockMode === "period" ? "bg-background text-foreground shadow-sm" : "hover:text-foreground"
                )}
              >
                Spärra period
              </button>
            </div>

            {/* Plats — pinned (always visible; it unlocks the calendar) */}
            <div className="space-y-2">
              <Label htmlFor="space">Plats</Label>
              <select
                id="space"
                className="w-full border rounded-md p-2"
                value={newBlockedDate.space}
                onChange={(e) => setNewBlockedDate(prev => ({ ...prev, space: e.target.value }))}
              >
                <option value="">Välj plats...</option>
                {spaces.map(space => (
                  <option key={space.id} value={space.id}>{space.name}</option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-1 px-1 -mx-1">
              {blockMode === "day" && (
                <div className="space-y-2">
                  <Label htmlFor="date">Datum</Label>
                  <Input
                    id="date"
                    type="date"
                    value={newBlockedDate.date}
                    onChange={(e) => setNewBlockedDate(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="time_slot">Tidslucka</Label>
                <select
                  id="time_slot"
                  className="w-full border rounded-md p-2"
                  value={newBlockedDate.time_slot}
                  onChange={(e) => setNewBlockedDate(prev => ({ ...prev, time_slot: e.target.value as any }))}
                >
                  <option value="all_day">Hela dagen</option>
                  <option value="morning">Morgon/Lunch (06-15)</option>
                  <option value="evening">Kväll (16-03)</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Anledning (valfritt)</Label>
                <Input
                  id="reason"
                  placeholder="T.ex. Torgmarknad"
                  value={newBlockedDate.reason}
                  onChange={(e) => setNewBlockedDate(prev => ({ ...prev, reason: e.target.value }))}
                />
              </div>

              {blockMode === "period" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Datum {newBlockedDate.space ? "" : "(välj plats först)"}</Label>
                    {periodDates.length > 0 && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                        onClick={() => setPeriodDates([])}
                      >
                        Rensa
                      </button>
                    )}
                  </div>
                  <div className={cn("rounded-md border p-3", !newBlockedDate.space && "opacity-50 pointer-events-none")}>
                    <MultiDateCalendar
                      selected={periodDates}
                      disabledDates={alreadyBlockedForSelection}
                      bookingsByDate={periodBookingsByDate}
                      onToggle={(date) =>
                        setPeriodDates(prev =>
                          prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]
                        )
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {periodDates.length > 0
                      ? `${periodDates.length} ${periodDates.length === 1 ? "dag" : "dagar"} markerade`
                      : "Klicka på datum för att markera dem. Bläddra mellan månader med pilarna."}
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={closeBlockDialog}>
                Avbryt
              </Button>
              {blockMode === "day" ? (
                <Button onClick={handleCreateBlockedDate} disabled={!newBlockedDate.space || !newBlockedDate.date}>
                  Spärra
                </Button>
              ) : (
                <Button
                  onClick={handleCreateBlockedPeriod}
                  disabled={!newBlockedDate.space || periodDates.length === 0 || savingBlock}
                >
                  {savingBlock
                    ? "Sparar…"
                    : `Spara${periodDates.length > 0 ? ` (${periodDates.length})` : ""}`}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Food Truck Dialog */}
        <Dialog open={addTruckDialog} onOpenChange={(open) => {
          setAddTruckDialog(open)
          if (!open) {
            setCreateNewUser(false)
            setNewTruck({
              name: "",
              description: "",
              userId: "",
              userEmail: "",
              userPassword: "",
              userFirstName: "",
              userLastName: ""
            })
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Lägg till aktör</DialogTitle>
              <DialogDescription>
                Skapa en ny foodtruck och koppla till en användare
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="truckName">Namn på foodtruck *</Label>
                <Input
                  id="truckName"
                  placeholder="T.ex. Goda Grillen"
                  value={newTruck.name}
                  onChange={(e) => setNewTruck(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="truckDesc">Beskrivning</Label>
                <Input
                  id="truckDesc"
                  placeholder="Kort beskrivning..."
                  value={newTruck.description}
                  onChange={(e) => setNewTruck(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="checkbox"
                    id="createNewUser"
                    checked={createNewUser}
                    onChange={(e) => setCreateNewUser(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="createNewUser" className="cursor-pointer">
                    Skapa ny användare
                  </Label>
                </div>

                {createNewUser ? (
                  <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="userFirstName">Förnamn *</Label>
                        <Input
                          id="userFirstName"
                          value={newTruck.userFirstName}
                          onChange={(e) => setNewTruck(prev => ({ ...prev, userFirstName: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="userLastName">Efternamn *</Label>
                        <Input
                          id="userLastName"
                          value={newTruck.userLastName}
                          onChange={(e) => setNewTruck(prev => ({ ...prev, userLastName: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="userEmail">E-post *</Label>
                      <Input
                        id="userEmail"
                        type="email"
                        value={newTruck.userEmail}
                        onChange={(e) => setNewTruck(prev => ({ ...prev, userEmail: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="userPassword">Lösenord *</Label>
                      <Input
                        id="userPassword"
                        type="password"
                        value={newTruck.userPassword}
                        onChange={(e) => setNewTruck(prev => ({ ...prev, userPassword: e.target.value }))}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="userId">Välj befintlig användare *</Label>
                    <select
                      id="userId"
                      className="w-full border rounded-md p-2"
                      value={newTruck.userId}
                      onChange={(e) => setNewTruck(prev => ({ ...prev, userId: e.target.value }))}
                    >
                      <option value="">Välj användare...</option>
                      {availableUsers.map(user => (
                        <option key={user.id} value={user.id}>
                          {user.first_name} {user.last_name} ({user.email})
                        </option>
                      ))}
                    </select>
                    {availableUsers.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Inga lediga användare. Skapa en ny istället.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddTruckDialog(false)}>
                Avbryt
              </Button>
              <Button
                onClick={handleCreateFoodTruck}
                disabled={creatingTruck || !newTruck.name || (!createNewUser && !newTruck.userId)}
              >
                {creatingTruck ? "Skapar..." : "Skapa"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Document Dialog */}
        <Dialog open={addDocumentDialog} onOpenChange={(open) => {
          setAddDocumentDialog(open)
          if (!open) {
            setNewDocument({ title: "", description: "", link_type: "url", url: "" })
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Lägg till dokument/länk</DialogTitle>
              <DialogDescription>
                Lägg till en länk till en webbsida eller PDF som ska visas för foodtruck-användare
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="docTitle">Titel *</Label>
                <Input
                  id="docTitle"
                  placeholder="T.ex. Riktlinjer för torghandel"
                  value={newDocument.title}
                  onChange={(e) => setNewDocument(prev => ({ ...prev, title: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="docDescription">Beskrivning</Label>
                <Textarea
                  id="docDescription"
                  placeholder="En kort beskrivning av dokumentet..."
                  value={newDocument.description}
                  onChange={(e) => setNewDocument(prev => ({ ...prev, description: e.target.value }))}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="docUrl">URL *</Label>
                <Input
                  id="docUrl"
                  placeholder="https://kommun.se/riktlinjer.pdf"
                  value={newDocument.url}
                  onChange={(e) => setNewDocument(prev => ({ ...prev, url: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Klistra in länken till dokumentet eller webbsidan
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDocumentDialog(false)}>
                Avbryt
              </Button>
              <Button
                onClick={handleCreateDocument}
                disabled={creatingDocument || !newDocument.title || !newDocument.url}
              >
                {creatingDocument ? "Lägger till..." : "Lägg till"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {/* Schedule booking → foodtruck preview Dialog */}
        <Dialog open={!!scheduleDetail} onOpenChange={(open) => { if (!open) setScheduleDetail(null) }}>
          <DialogContent
            className="max-w-md p-0 overflow-hidden gap-0 flex flex-col"
            style={{
              maxHeight: "92vh",
              translate: "none",
              transform: "translate(-50%, -50%)",
            }}
          >
            {(() => {
              if (!scheduleDetail) return null
              const truck = foodTruckById[scheduleDetail.foodtruckId]
              const image = truck?.image
              const name = truck?.name || scheduleDetail.foodtruckName
              return (
                <>
                  <DialogHeader className="sr-only">
                    <DialogTitle>{name}</DialogTitle>
                    <DialogDescription>Bokningsinformation och foodtruck-detaljer</DialogDescription>
                  </DialogHeader>

                  {/* Hero image */}
                  <div className="h-48 bg-muted relative shrink-0">
                    {image ? (
                      <img
                        src={`${DIRECTUS_URL}/assets/${image}`}
                        alt={name}
                        className="absolute inset-0 w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).src = "/food-truck-logo.svg" }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Soup className="h-14 w-14 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                    <div>
                      <h2 className="text-xl font-bold">{name}</h2>
                      {truck && !truck.active && (
                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">Inaktiv</span>
                      )}
                    </div>

                    {/* Booking context */}
                    <div className="grid grid-cols-1 gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Calendar size={15} className="text-muted-foreground shrink-0" />
                        <span className="capitalize">
                          {format(new Date(`${scheduleDetail.date}T12:00:00`), "EEEE d MMMM yyyy", { locale: sv })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin size={15} className="text-muted-foreground shrink-0" />
                        <span>{scheduleDetail.space}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {scheduleDetail.slot === "morning"
                          ? <Sun size={15} className="text-amber-600 shrink-0" />
                          : <Moon size={15} className="text-indigo-600 shrink-0" />}
                        <span>{scheduleDetail.slot === "morning" ? "Morgon/Lunch (06–15)" : "Kväll (16–03)"}</span>
                      </div>
                    </div>

                    {truck?.description && (
                      <p className="text-sm text-muted-foreground">{truck.description}</p>
                    )}

                    {truck?.user && (
                      <div className="flex items-start gap-2 text-sm">
                        <Users size={15} className="text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium">{truck.user.first_name} {truck.user.last_name}</p>
                          <a href={`mailto:${truck.user.email}`} className="text-blue-600 hover:underline">
                            {truck.user.email}
                          </a>
                        </div>
                      </div>
                    )}

                    {truck && (
                      <p className="text-xs text-muted-foreground">
                        {truck.bookings?.length || 0} bokningar totalt
                      </p>
                    )}

                    {!truck && (
                      <p className="text-sm text-muted-foreground">
                        Foodtrucken finns inte längre i systemet — endast bokningens namn visas.
                      </p>
                    )}
                  </div>
                </>
              )
            })()}
          </DialogContent>
        </Dialog>

        {/* Space create/edit dialog */}
        <SpaceDialog
          open={spaceDialog.open}
          onOpenChange={(open) => setSpaceDialog(prev => ({ ...prev, open }))}
          space={spaceDialog.space}
          onSaved={loadData}
        />

        {/* Space delete — type "bekräfta" */}
        <ConfirmDialog
          open={deleteSpaceDialog.open}
          onOpenChange={(open) => setDeleteSpaceDialog(prev => ({ ...prev, open }))}
          title={`Ta bort ${deleteSpaceDialog.space?.name ?? "platsen"}?`}
          description="Vill du göra dessa ändringar? Platsen tas bort permanent. Detta går inte att ångra. (Går inte om platsen har bokningar.)"
          destructive
          requireText="bekräfta"
          confirmLabel="Ta bort"
          loading={deletingSpace}
          onConfirm={handleDeleteSpace}
        />

        {/* Booking rules save confirm */}
        <ConfirmDialog
          open={rulesConfirm}
          onOpenChange={setRulesConfirm}
          title="Spara bokningsregler?"
          description="Vill du göra dessa ändringar? De gäller direkt för alla foodtrucks."
          confirmLabel="Spara"
          loading={savingRules}
          onConfirm={handleSaveRules}
        />
      </SidebarProvider>
    </ProtectedRoute>
  )
}
