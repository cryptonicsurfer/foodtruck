"use client"

import { useEffect, useRef, useState } from "react"
import { MAP_STYLE_URL, loadMaplibre } from "@/lib/maplibre"

/** A small, non-interactive map with one pin — for the assistant's place cards. */
export function SpaceMiniMap({ lng, lat, height = 120 }: { lng: number; lat: number; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let instance: import("maplibre-gl").Map | null = null
    loadMaplibre()
      .then((ml) => {
        if (cancelled || !containerRef.current) return
        instance = new ml.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [lng, lat],
          zoom: 16,
          interactive: false,
          attributionControl: false,
        })
        new ml.Marker({ color: "#FF5722" }).setLngLat([lng, lat]).addTo(instance)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      instance?.remove()
    }
  }, [lng, lat])

  if (failed) return null
  return (
    <div className="relative w-full overflow-hidden rounded-md border" style={{ height }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      <span className="absolute bottom-0.5 right-1 text-[9px] text-muted-foreground bg-white/70 px-1 rounded">© OpenStreetMap</span>
    </div>
  )
}
