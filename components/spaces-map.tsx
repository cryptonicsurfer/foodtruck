'use client'

import React, { useEffect, useRef, useState } from 'react';
import type { Map as MaplibreMap, Marker as MaplibreMarker } from 'maplibre-gl';
import { MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { FALKENBERG_CENTER, MAP_STYLE_URL, loadMaplibre } from '@/lib/maplibre';

interface Space {
  id: string | number;
  name: string;
  location: {
    type?: string;
    coordinates?: [number, number]; // [longitude, latitude]
  };
  description?: string | null;
  time_slots?: Array<{
    description: string;
    start: string;
    end: string;
  }>;
  bookings?: Array<number>;
}

interface SpacesMapProps {
  spaces: Space[];
  center?: {
    lat: number;
    lng: number;
  };
  zoom?: number;
  height?: string;
  width?: string;
  onSpaceSelect?: (space: Space) => void;
}

const hasCoords = (space: Space) =>
  !!space.location && !!space.location.coordinates && space.location.coordinates.length === 2;

// Orange dot, same look as the old Google marker
function markerElement(title: string) {
  const el = document.createElement('div');
  el.title = title;
  el.style.cssText =
    'width:18px;height:18px;border-radius:50%;background:#FF5722;border:2px solid #B71C1C;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer;';
  return el;
}

// Popup content built as DOM nodes (not an HTML string) so names/descriptions are never parsed as HTML
function popupContent(space: Space, onSelect?: (space: Space) => void) {
  const root = document.createElement('div');
  root.style.cssText = 'padding:4px;max-width:200px;font-family:inherit;';
  const name = document.createElement('strong');
  name.textContent = space.name;
  const desc = document.createElement('p');
  desc.style.cssText = 'margin:4px 0;font-size:12px;';
  desc.textContent = space.description || 'No description available';
  root.append(name, desc);
  if (onSelect) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'View Details';
    button.style.cssText =
      'background:#0284c7;color:white;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;margin-top:4px;font-size:12px;';
    button.addEventListener('click', () => onSelect(space));
    root.append(button);
  }
  return root;
}

const SpacesMap: React.FC<SpacesMapProps> = ({
  spaces,
  center = FALKENBERG_CENTER,
  zoom = 17,
  height = "600px",
  width = "100%",
  onSpaceSelect
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<MaplibreMarker[]>([]);
  const onSelectRef = useRef(onSpaceSelect);
  onSelectRef.current = onSpaceSelect;
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);

  // Create the map once
  useEffect(() => {
    let cancelled = false;
    let instance: MaplibreMap | null = null;

    loadMaplibre()
      .then((ml) => {
        if (cancelled || !containerRef.current) return;
        instance = new ml.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [center.lng, center.lat],
          zoom,
          attributionControl: { compact: true },
        });
        instance.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        instance.addControl(new ml.FullscreenControl(), 'top-right');
        instance.addControl(new ml.ScaleControl(), 'bottom-left');
        instance.on('load', () => !cancelled && setMap(instance));
        instance.on('error', (e) => console.error('Map error:', e.error));
      })
      .catch((error) => {
        console.error('Error loading map:', error);
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      instance?.remove();
    };
    // Center/zoom are initial values only; later framing is done by the markers effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)create markers when the map is ready or the spaces change
  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    loadMaplibre().then((ml) => {
      if (cancelled) return;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];

      const located = spaces.filter(hasCoords);
      for (const space of located) {
        const el = markerElement(space.name);
        el.addEventListener('click', () => setSelectedSpace(space));
        const popup = new ml.Popup({ offset: 14, closeButton: true }).setDOMContent(
          popupContent(space, onSelectRef.current ? (s) => onSelectRef.current?.(s) : undefined)
        );
        markersRef.current.push(
          new ml.Marker({ element: el }).setLngLat(space.location.coordinates!).setPopup(popup).addTo(map)
        );
      }

      // Frame all spaces; a single space keeps the requested zoom
      if (located.length > 1) {
        const bounds = new ml.LngLatBounds();
        located.forEach((space) => bounds.extend(space.location.coordinates!));
        map.fitBounds(bounds, { padding: 60, maxZoom: zoom, duration: 0 });
      } else if (located.length === 1) {
        map.jumpTo({ center: located[0].location.coordinates!, zoom });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [map, spaces, zoom]);

  // Remove markers on unmount
  useEffect(() => {
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, []);

  if (loadError) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height, width }}>
        Kunde inte ladda kartan.
      </div>
    );
  }

  return (
    <div className="relative" style={{ height, width }}>
      <div ref={containerRef} className="overflow-hidden rounded-lg" style={{ height: "100%", width: "100%" }} />
      {!map && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      )}

      {selectedSpace && (
        <Card className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 shadow-lg z-10 bg-white">
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <div className="bg-primary rounded-full p-1.5 text-white">
                <MapPin size={16} />
              </div>
              <div className="flex-1">
                <h3 className="font-medium">{selectedSpace.name}</h3>
                <p className="text-sm text-muted-foreground">{selectedSpace.description || 'No description available'}</p>

                {selectedSpace.time_slots && selectedSpace.time_slots.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Available time slots:</p>
                    <div className="space-y-1">
                      {selectedSpace.time_slots.map((slot, index) => (
                        <div key={index} className="text-xs bg-muted px-2 py-1 rounded">
                          {slot.description}: {slot.start.substring(0, 5)} - {slot.end.substring(0, 5)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  className="mt-3 text-xs text-primary hover:underline"
                  onClick={() => setSelectedSpace(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SpacesMap;
