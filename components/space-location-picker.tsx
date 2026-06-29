"use client"

import { useState } from "react"
import { GoogleMap, Marker } from "@react-google-maps/api"
import { useMapsApi } from "@/lib/maps-context"
import { Button } from "@/components/ui/button"
import { MapPin } from "lucide-react"

export interface LatLng {
  lat: number
  lng: number
}

interface SpaceLocationPickerProps {
  value: LatLng | null
  onChange: (value: LatLng | null) => void
  height?: string
}

// Falkenberg centrum
const DEFAULT_CENTER: LatLng = { lat: 56.9055, lng: 12.4912 }

export function SpaceLocationPicker({ value, onChange, height = "320px" }: SpaceLocationPickerProps) {
  const { isLoaded, loadError } = useMapsApi()
  const [center] = useState<LatLng>(value ?? DEFAULT_CENTER)

  if (loadError) {
    return (
      <div className="text-sm text-red-600">
        Kunde inte ladda kartan. Du kan fortfarande spara platsen utan koordinat.
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div
        className="flex items-center justify-center rounded-md border bg-muted/40 text-sm text-muted-foreground"
        style={{ height }}
      >
        Laddar karta…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <GoogleMap
        mapContainerStyle={{ height, width: "100%", borderRadius: "0.5rem" }}
        center={center}
        zoom={value ? 17 : 14}
        onClick={(e) => {
          if (e.latLng) onChange({ lat: e.latLng.lat(), lng: e.latLng.lng() })
        }}
        options={{
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        }}
      >
        {value && <Marker position={value} />}
      </GoogleMap>

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <MapPin size={13} className="shrink-0" />
          {value
            ? `${value.lat.toFixed(6)}, ${value.lng.toFixed(6)}`
            : "Ingen koordinat satt — klicka på kartan för att placera platsen"}
        </span>
        {value && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => onChange(null)}>
            Rensa
          </Button>
        )}
      </div>
    </div>
  )
}
