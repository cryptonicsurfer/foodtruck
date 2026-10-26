/**
 * MapLibre GL + OpenFreeMap — the app's map stack (replaced Google Maps 2026-10-26).
 * No API key: tiles and style come from OpenFreeMap (OpenStreetMap data). If that
 * service ever goes away, swapping MAP_STYLE_URL to another provider is the only change.
 *
 * maplibre-gl touches `window`, so it is only imported in the browser via loadMaplibre().
 */
import type * as MaplibreModule from "maplibre-gl"

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"

// Falkenberg centrum
export const FALKENBERG_CENTER = { lat: 56.9055, lng: 12.4912 }

let loader: Promise<typeof MaplibreModule> | null = null

export function loadMaplibre() {
  loader ??= import("maplibre-gl").then((ml) => {
    // Worker is copied to public/ by scripts/copy-maplibre-worker.mjs
    ml.setWorkerUrl(`/maplibre-gl-worker.mjs?v=${ml.getVersion()}`)
    return ml
  })
  return loader
}
