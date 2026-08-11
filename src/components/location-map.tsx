'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/* ── Custom pin SVG (inline, no external assets) ── */
function createPinIcon(): L.DivIcon {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48" fill="none">
      <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" fill="#33492F"/>
      <circle cx="18" cy="18" r="8" fill="white"/>
      <circle cx="18" cy="18" r="4" fill="#C9A96E"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: 'location-pin',
    iconSize: [36, 48],
    iconAnchor: [18, 48],
    popupAnchor: [0, -48],
  });
}

/* ── Component props ── */
interface LocationMapProps {
  /** Full address string for display in popup */
  address: string;
  /** Location fields for server-side geocoding API */
  location: {
    address?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    additionalInfo?: string | null;
  };
  /** Tailwind classes for the wrapper */
  className?: string;
}

export default function LocationMap({ address, location, className = '' }: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let map: L.Map | null = null;

    async function init() {
      // Build query params for our server-side geocoding API
      const params = new URLSearchParams();
      if (location.address) params.set('address', location.address);
      if (location.neighborhood) params.set('neighborhood', location.neighborhood);
      if (location.city) params.set('city', location.city);
      if (location.state) params.set('state', location.state);
      if (location.additionalInfo) params.set('additionalInfo', location.additionalInfo);

      let lat: number | null = null;
      let lng: number | null = null;

      try {
        const res = await fetch(`/api/enterprises/geocode?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.lat != null && data.lng != null) {
            lat = data.lat;
            lng = data.lng;
          }
        }
      } catch {
        // network error — will show error state
      }

      if (cancelled || lat === null || lng === null) {
        if (!cancelled) setStatus('error');
        return;
      }

      // Initialize map
      map = L.map(containerRef.current!, {
        center: [lat, lng],
        zoom: 16,
        zoomControl: true,
        attributionControl: true,
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        touchZoom: true,
        boxZoom: false,
        keyboard: false,
      });

      // Tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Custom marker
      const marker = L.marker([lat, lng], { icon: createPinIcon() }).addTo(map);

      // Popup with address only — no links
      if (address) {
        marker.bindPopup(
          `<div style="font-family:system-ui,sans-serif;font-size:13px;color:#1a1a1a;line-height:1.4;max-width:220px">${address.replace(/</g, '&lt;')}</div>`,
          { closeButton: true, className: 'location-popup' },
        );
      }

      mapRef.current = map;
      if (!cancelled) setStatus('ready');
    }

    init();

    return () => {
      cancelled = true;
      if (map) {
        map.remove();
        mapRef.current = null;
      }
    };
  }, [address, location]);

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="w-full h-full min-h-[260px] sm:min-h-[320px] rounded-2xl overflow-hidden" />

      {/* Loading skeleton */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#F7F6F3] rounded-2xl">
          <div className="flex flex-col items-center gap-2 text-[#1a1a1a]/25">
            <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-xs">Carregando mapa...</span>
          </div>
        </div>
      )}

      {/* Error fallback */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#F7F6F3] rounded-2xl">
          <div className="flex flex-col items-center gap-2 text-[#1a1a1a]/25 text-center px-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            <span className="text-xs">Mapa indisponível</span>
          </div>
        </div>
      )}

      {/* Scoped styles */}
      <style>{`
        .location-pin {
          background: none !important;
          border: none !important;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        }
        .location-popup .leaflet-popup-content-wrapper {
          border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.1);
          padding: 4px;
        }
        .location-popup .leaflet-popup-content {
          margin: 8px 12px;
        }
        .location-popup .leaflet-popup-tip {
          box-shadow: 0 4px 16px rgba(0,0,0,0.1);
        }
      `}</style>
    </div>
  );
}
