"use client"

import { useEffect, useRef, useState } from "react"
import type { Map as MaplibreMap, Marker as MaplibreMarker } from "maplibre-gl"
import { FALKENBERG_CENTER, MAP_STYLE_URL, loadMaplibre } from "@/lib/maplibre"
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

export function SpaceLocationPicker({ value, onChange, height = "320px" }: SpaceLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<MaplibreMarker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [map, setMap] = useState<MaplibreMap | null>(null)
  const [loadError, setLoadError] = useState(false)

  // Create the map once, centered on the current value (or Falkenberg)
  useEffect(() => {
    let cancelled = false
    let instance: MaplibreMap | null = null
    const start = value ?? FALKENBERG_CENTER

    loadMaplibre()
      .then((ml) => {
        if (cancelled || !containerRef.current) return
        instance = new ml.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [start.lng, start.lat],
          zoom: value ? 17 : 14,
          attributionControl: { compact: true },
        })
        instance.addControl(new ml.NavigationControl({ showCompass: false }), "top-right")
        instance.getCanvas().style.cursor = "crosshair"
        instance.on("click", (e) => onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }))
        instance.on("load", () => !cancelled && setMap(instance))
      })
      .catch((error) => {
        console.error("Error loading map:", error)
        if (!cancelled) setLoadError(true)
      })

    return () => {
      cancelled = true
      instance?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the marker in sync with the value
  useEffect(() => {
    if (!map) return
    if (!value) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    if (markerRef.current) {
      markerRef.current.setLngLat([value.lng, value.lat])
      return
    }
    let cancelled = false
    loadMaplibre().then((ml) => {
      if (cancelled) return
      markerRef.current = new ml.Marker({ color: "#FF5722" }).setLngLat([value.lng, value.lat]).addTo(map)
    })
    return () => {
      cancelled = true
    }
  }, [map, value])

  if (loadError) {
    return (
      <div className="text-sm text-red-600">
        Kunde inte ladda kartan. Du kan fortfarande spara platsen utan koordinat.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative" style={{ height }}>
        <div ref={containerRef} className="overflow-hidden rounded-lg" style={{ height: "100%", width: "100%" }} />
        {!map && (
          <div className="absolute inset-0 flex items-center justify-center rounded-md border bg-muted/40 text-sm text-muted-foreground">
            Laddar karta…
          </div>
        )}
      </div>

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
