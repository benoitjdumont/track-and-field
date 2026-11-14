import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerCode from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';
import type { MapSettings, TrackPoint, Waypoint } from '../types/track';

// Provide a self-contained Blob URL for MapLibre's Web Worker so Vite dev dependency
// optimization (.vite/deps) and proxy redirects never break worker loading.
let workerConfigured = false;
if (!workerConfigured && typeof window !== 'undefined' && typeof Blob !== 'undefined') {
  const workerBlob = new Blob([maplibreWorkerCode], { type: 'text/javascript' });
  maplibregl.setWorkerUrl(URL.createObjectURL(workerBlob));
  workerConfigured = true;
}

interface MapStageProps {
  center: [number, number]; // [lng, lat]
  zoom?: number;
  bearing?: number;
  settings: MapSettings;
  points: TrackPoint[];
  activeProgressCoords?: [number, number][]; // Used in Creation Mode flyover
  livePosition?: [number, number] | null;
  waypoints: Waypoint[];
  highlightedWaypointId?: string | null;
  followTarget?: [number, number] | null;
  interactive?: boolean;
  accentColor?: string;
  isDark?: boolean;
  lang?: 'fr' | 'en';
  onMapReady?: (map: maplibregl.Map, canvas: HTMLCanvasElement) => void;
  onWaypointClick?: (wp: Waypoint) => void;
  onPitchChanged?: (pitch: number) => void;
}

function buildInitialStyle(settings: MapSettings, isDark: boolean): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: 'TrackAndField3D',
    sources: {
      'esri-satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      },
      'osm-streets': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{y}/{x}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{y}/{x}.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{y}/{x}.png',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap · © CARTO',
      },
      'satellite-labels': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{y}/{x}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{y}/{x}.png',
        ],
        tileSize: 256,
        maxzoom: 19,
      },
      openfreemap: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      },
      'terrain-dem': {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
      },
    },
    layers: [
      {
        id: 'background-base',
        type: 'background',
        paint: { 'background-color': isDark ? '#090D12' : '#E2E8F0' },
      },
      {
        id: 'layer-streets',
        type: 'raster',
        source: 'osm-streets',
        layout: { visibility: settings.satellite ? 'none' : 'visible' },
        paint: { 'raster-opacity': 1 },
      },
      {
        id: 'layer-satellite',
        type: 'raster',
        source: 'esri-satellite',
        layout: { visibility: settings.satellite ? 'visible' : 'none' },
        paint: { 'raster-opacity': 1, 'raster-contrast': 0.06, 'raster-saturation': 0.08 },
      },
      {
        id: 'layer-satellite-labels',
        type: 'raster',
        source: 'satellite-labels',
        layout: { visibility: settings.satellite ? 'visible' : 'none' },
        paint: { 'raster-opacity': 0.85 },
      },
      {
        id: 'layer-3d-buildings',
        type: 'fill-extrusion',
        source: 'openfreemap',
        'source-layer': 'building',
        minzoom: 13.5,
        layout: { visibility: settings.buildings3d ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': settings.satellite ? '#CBD5E1' : isDark ? '#334155' : '#94A3B8',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': settings.satellite ? 0.58 : 0.78,
        },
      },
    ],
  };
}

export const MapStage: React.FC<MapStageProps> = ({
  center,
  zoom = 15.6,
  bearing = 0,
  settings,
  points,
  activeProgressCoords,
  livePosition,
  waypoints,
  highlightedWaypointId,
  followTarget,
  interactive = true,
  accentColor = '#FF5A1F',
  isDark = true,
  lang = 'fr',
  onMapReady,
  onWaypointClick,
  onPitchChanged,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const waypointMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const liveMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [webglError, setWebglError] = useState(false);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildInitialStyle(settings, isDark),
        center,
        zoom,
        pitch: settings.pitch,
        bearing,
        maxPitch: 78,
        interactive,
        canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
        attributionControl: { compact: true },
      });
    } catch {
      setWebglError(true);
      return;
    }

    mapRef.current = map;

    map.on('error', (e: { error?: unknown }) => {
      // Only flag fatal WebGL failures, ignore transient network tile hiccups
      if (e.error && String(e.error).toLowerCase().includes('webgl')) {
        setWebglError(true);
      }
    });

    map.on('pitchend', () => {
      if (onPitchChanged) {
        onPitchChanged(Math.round(map.getPitch()));
      }
    });

    map.on('load', () => {
      // Add route geojson sources & layers
      map.addSource('route-full', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        },
      });

      map.addSource('route-active', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        },
      });

      map.addLayer({
        id: 'route-full-base',
        type: 'line',
        source: 'route-full',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#FFFFFF',
          'line-width': 6,
          'line-opacity': 0.25,
        },
      });

      map.addLayer({
        id: 'route-active-glow',
        type: 'line',
        source: 'route-active',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': accentColor,
          'line-width': 12,
          'line-opacity': 0.34,
          'line-blur': 4,
        },
      });

      map.addLayer({
        id: 'route-active-core',
        type: 'line',
        source: 'route-active',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': accentColor,
          'line-width': 5,
          'line-opacity': 0.98,
        },
      });

      if (settings.terrain3d) {
        try {
          map.setTerrain({ source: 'terrain-dem', exaggeration: 1.45 });
        } catch {
          // ignore if terrain source unavailable
        }
      }

      setMapLoaded(true);
      if (onMapReady) {
        onMapReady(map, map.getCanvas());
      }
    });

    return () => {
      waypointMarkersRef.current.forEach((m) => m.remove());
      waypointMarkersRef.current.clear();
      liveMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync Satellite, 3D Buildings, 3D Terrain, Pitch, Night/Day & Accent Color
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    try {
      map.setPaintProperty('background-base', 'background-color', isDark ? '#090D12' : '#E2E8F0');
      map.setLayoutProperty('layer-satellite', 'visibility', settings.satellite ? 'visible' : 'none');
      map.setLayoutProperty(
        'layer-satellite-labels',
        'visibility',
        settings.satellite ? 'visible' : 'none'
      );
      map.setLayoutProperty('layer-streets', 'visibility', settings.satellite ? 'none' : 'visible');
      map.setLayoutProperty(
        'layer-3d-buildings',
        'visibility',
        settings.buildings3d ? 'visible' : 'none'
      );
      map.setPaintProperty(
        'layer-3d-buildings',
        'fill-extrusion-color',
        settings.satellite ? '#E2E8F0' : isDark ? '#334155' : '#94A3B8'
      );
      map.setPaintProperty(
        'layer-3d-buildings',
        'fill-extrusion-opacity',
        settings.satellite ? 0.56 : 0.8
      );
      map.setPaintProperty(
        'layer-streets',
        'raster-brightness-max',
        isDark && !settings.satellite ? 0.62 : 1
      );
      map.setPaintProperty('route-active-glow', 'line-color', accentColor);
      map.setPaintProperty('route-active-core', 'line-color', accentColor);

      if (settings.terrain3d) {
        map.setTerrain({ source: 'terrain-dem', exaggeration: 1.45 });
      } else {
        map.setTerrain(null);
      }

      if (Math.abs(map.getPitch() - settings.pitch) > 1) {
        map.easeTo({ pitch: settings.pitch, duration: 280 });
      }
    } catch {
      // safe guard during style transitions
    }
  }, [mapLoaded, settings, accentColor, isDark]);

  // Update Route GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const fullCoords = points.map((p) => [p.lng, p.lat] as [number, number]);
    const activeCoords = activeProgressCoords ?? fullCoords;

    const fullSrc = map.getSource('route-full') as maplibregl.GeoJSONSource | undefined;
    const activeSrc = map.getSource('route-active') as maplibregl.GeoJSONSource | undefined;

    if (fullSrc) {
      fullSrc.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: fullCoords.length >= 2 ? fullCoords : [],
        },
      });
    }
    if (activeSrc) {
      activeSrc.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: activeCoords.length >= 2 ? activeCoords : [],
        },
      });
    }
  }, [mapLoaded, points, activeProgressCoords]);

  // Smooth camera follow during live GPS or flyover
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !followTarget) return;
    map.easeTo({
      center: followTarget,
      bearing,
      pitch: settings.pitch,
      duration: 420,
    });
  }, [mapLoaded, followTarget, bearing, settings.pitch]);

  // Live GPS / Flyover position beacon
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (!livePosition) {
      liveMarkerRef.current?.remove();
      liveMarkerRef.current = null;
      return;
    }

    if (!liveMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'relative flex items-center justify-center w-7 h-7';
      el.innerHTML = `
        <span data-tf-ping class="absolute w-7 h-7 rounded-full animate-ping" style="background-color:${accentColor};opacity:0.35;"></span>
        <span data-tf-dot class="relative w-4 h-4 rounded-full border-[2.5px] border-white shadow-lg" style="background-color:${accentColor};"></span>
      `;
      liveMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(livePosition)
        .addTo(map);
    } else {
      const el = liveMarkerRef.current.getElement();
      const ping = el.querySelector<HTMLElement>('[data-tf-ping]');
      const dot = el.querySelector<HTMLElement>('[data-tf-dot]');
      if (ping) ping.style.backgroundColor = accentColor;
      if (dot) dot.style.backgroundColor = accentColor;
      liveMarkerRef.current.setLngLat(livePosition);
    }
  }, [mapLoaded, livePosition, accentColor]);

  // Waypoint markers (Photo / Video / Voice)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const currentIds = new Set(waypoints.map((w) => w.id));
    waypointMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        waypointMarkersRef.current.delete(id);
      }
    });

    waypoints.forEach((wp) => {
      let existing = waypointMarkersRef.current.get(wp.id);
      const isHighlighted = wp.id === highlightedWaypointId;

      if (!existing) {
        const el = document.createElement('button');
        el.type = 'button';
        el.setAttribute('aria-label', wp.title);
        el.className =
          'group flex items-center justify-center w-10 h-10 rounded-full border-2 border-white shadow-xl transition-transform duration-150 hover:scale-110 cursor-pointer';
        const bgColor =
          wp.type === 'photo'
            ? accentColor
            : wp.type === 'video'
              ? '#0EA5E9'
              : '#10B981';
        el.style.backgroundColor = bgColor;

        const iconSvg =
          wp.type === 'photo'
            ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`
            : wp.type === 'video'
              ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>`
              : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;

        el.innerHTML = iconSvg;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onWaypointClick?.(wp);
        });

        existing = new maplibregl.Marker({ element: el }).setLngLat([wp.lng, wp.lat]).addTo(map);
        waypointMarkersRef.current.set(wp.id, existing);
      }

      const el = existing.getElement();
      if (wp.type === 'photo') {
        el.style.backgroundColor = accentColor;
      }
      el.style.transform = isHighlighted ? 'scale(1.28)' : '';
      el.style.boxShadow = isHighlighted
        ? `0 0 0 5px ${accentColor}73, 0 10px 24px rgba(0,0,0,0.6)`
        : '';
      el.style.zIndex = isHighlighted ? '30' : '10';
    });
  }, [mapLoaded, waypoints, highlightedWaypointId, onWaypointClick, accentColor]);

  if (webglError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 dark:bg-[#090D12] text-slate-700 dark:text-slate-300 p-6 text-center">
        <p className="font-display text-lg font-semibold text-slate-900 dark:text-white">
          {lang === 'en'
            ? '3D WebGL rendering unavailable on this device'
            : 'Rendu 3D WebGL indisponible sur cet appareil'}
        </p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          {lang === 'en'
            ? 'Enable hardware acceleration in your browser to display the 3D satellite map.'
            : 'Activez l’accélération matérielle dans votre navigateur pour afficher la carte satellite 3D.'}
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full relative select-none" />;
};
