import type { RecordedSession, TrackPoint, TrackStats, Waypoint } from '../types/track';

const EARTH_RADIUS_KM = 6371;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function computeBearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatPace(speedKmh: number): string {
  if (!Number.isFinite(speedKmh) || speedKmh < 0.4) return '--\'--"';
  const minPerKm = 60 / speedKmh;
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  if (secs === 60) return `${mins + 1}'00"`;
  return `${mins}'${String(secs).padStart(2, '0')}"`;
}

export function computeTrackStats(
  points: TrackPoint[],
  waypoints: Waypoint[],
  elapsedMsOverride?: number
): TrackStats {
  if (points.length === 0) {
    return {
      distanceKm: 0,
      durationSec: elapsedMsOverride ? Math.floor(elapsedMsOverride / 1000) : 0,
      avgSpeedKmh: 0,
      maxSpeedKmh: 0,
      elevationGainM: 0,
      elevationLossM: 0,
      paceMinPerKm: '--\'--"',
      waypointCount: waypoints.length,
    };
  }

  let distanceKm = 0;
  let maxSpeedKmh = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const segKm = haversineKm(prev, curr);
    distanceKm += segKm;

    const dtSec = Math.max(0.5, (curr.timestamp - prev.timestamp) / 1000);
    const computedKmh = (segKm / dtSec) * 3600;
    const sensorKmh = curr.speed > 0 ? curr.speed * 3.6 : computedKmh;
    if (sensorKmh < 120) {
      maxSpeedKmh = Math.max(maxSpeedKmh, sensorKmh);
    }

    const dAlt = curr.altitude - prev.altitude;
    if (dAlt > 0.6) elevationGainM += dAlt;
    else if (dAlt < -0.6) elevationLossM += Math.abs(dAlt);
  }

  const rawDurationSec =
    elapsedMsOverride !== undefined
      ? Math.max(1, Math.floor(elapsedMsOverride / 1000))
      : Math.max(
          1,
          Math.floor((points[points.length - 1].timestamp - points[0].timestamp) / 1000)
        );

  const avgSpeedKmh = rawDurationSec > 0 ? (distanceKm / rawDurationSec) * 3600 : 0;

  return {
    distanceKm,
    durationSec: rawDurationSec,
    avgSpeedKmh,
    maxSpeedKmh: Math.max(maxSpeedKmh, avgSpeedKmh),
    elevationGainM: Math.round(elevationGainM),
    elevationLossM: Math.round(elevationLossM),
    paceMinPerKm: formatPace(avgSpeedKmh),
    waypointCount: waypoints.length,
  };
}

export function getCumulativeDistances(points: TrackPoint[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversineKm(points[i - 1], points[i]));
  }
  return cum;
}

export function normalizeWaypointProgress(points: TrackPoint[], waypoints: Waypoint[]): Waypoint[] {
  if (points.length < 2) return waypoints;
  const cum = getCumulativeDistances(points);
  const totalKm = cum[cum.length - 1] || 0.001;

  return waypoints.map((wp) => {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = haversineKm(points[i], wp);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const distanceKm = cum[bestIdx];
    const progress = Math.max(0.02, Math.min(0.98, distanceKm / totalKm));
    return { ...wp, distanceKm, progress };
  });
}

export interface InterpolatedState {
  lat: number;
  lng: number;
  altitude: number;
  bearing: number;
  distanceKm: number;
  speedKmh: number;
  partialCoords: [number, number][];
}

export function interpolateRouteAt(points: TrackPoint[], progress: number): InterpolatedState {
  if (points.length === 0) {
    return {
      lat: 45.5048,
      lng: -73.5872,
      altitude: 120,
      bearing: 0,
      distanceKm: 0,
      speedKmh: 0,
      partialCoords: [],
    };
  }
  if (points.length === 1) {
    return {
      lat: points[0].lat,
      lng: points[0].lng,
      altitude: points[0].altitude,
      bearing: 0,
      distanceKm: 0,
      speedKmh: 0,
      partialCoords: [[points[0].lng, points[0].lat]],
    };
  }

  const p = Math.max(0, Math.min(1, progress));
  const cum = getCumulativeDistances(points);
  const totalKm = cum[cum.length - 1];

  if (totalKm <= 0.00001) {
    return {
      lat: points[0].lat,
      lng: points[0].lng,
      altitude: points[0].altitude,
      bearing: 0,
      distanceKm: 0,
      speedKmh: 0,
      partialCoords: points.map((pt) => [pt.lng, pt.lat]),
    };
  }

  const targetKm = p * totalKm;
  let segIdx = 0;
  for (let i = 0; i < cum.length - 1; i++) {
    if (targetKm >= cum[i] && targetKm <= cum[i + 1]) {
      segIdx = i;
      break;
    }
    segIdx = i;
  }

  const a = points[segIdx];
  const b = points[Math.min(points.length - 1, segIdx + 1)];
  const segLen = Math.max(1e-9, cum[segIdx + 1] - cum[segIdx]);
  const localT = Math.max(0, Math.min(1, (targetKm - cum[segIdx]) / segLen));

  const lat = a.lat + (b.lat - a.lat) * localT;
  const lng = a.lng + (b.lng - a.lng) * localT;
  const altitude = a.altitude + (b.altitude - a.altitude) * localT;
  const bearing = computeBearing(a, b);
  const speedKmh = ((a.speed + b.speed) / 2) * 3.6;

  const partialCoords: [number, number][] = points.slice(0, segIdx + 1).map((pt) => [pt.lng, pt.lat]);
  partialCoords.push([lng, lat]);

  return {
    lat,
    lng,
    altitude,
    bearing,
    distanceKm: targetKm,
    speedKmh,
    partialCoords,
  };
}

/**
 * Generates an interactive scenic mountain-and-city demo trail (Mont-Royal -> Downtown)
 * with realistic elevation profile so users testing indoors can experience 3D buildings,
 * satellite terrain, and Mode Création immediately.
 */
export function buildDemoSession(): RecordedSession {
  const baseTime = Date.now() - 28 * 60 * 1000;
  const rawWaypoints: Array<[number, number, number]> = [
    [-73.5888, 45.5015, 118],
    [-73.5872, 45.5038, 146],
    [-73.5858, 45.5056, 178],
    [-73.5869, 45.5078, 206],
    [-73.5898, 45.5092, 224],
    [-73.5918, 45.5071, 212],
    [-73.5901, 45.5044, 198],
    [-73.5867, 45.5037, 194],
    [-73.5834, 45.5021, 142],
    [-73.5798, 45.5008, 95],
    [-73.5762, 45.4998, 64],
    [-73.5734, 45.5014, 52],
  ];

  // Densify with smooth curve points
  const points: TrackPoint[] = [];
  const totalSteps = 84;
  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const scaled = t * (rawWaypoints.length - 1);
    const idx = Math.min(rawWaypoints.length - 2, Math.floor(scaled));
    const frac = scaled - idx;
    const [lng1, lat1, alt1] = rawWaypoints[idx];
    const [lng2, lat2, alt2] = rawWaypoints[idx + 1];
    const smoothFrac = frac * frac * (3 - 2 * frac);
    const wave = Math.sin(t * Math.PI * 6) * 0.00012;
    points.push({
      lng: lng1 + (lng2 - lng1) * smoothFrac + wave,
      lat: lat1 + (lat2 - lat1) * smoothFrac,
      altitude: alt1 + (alt2 - alt1) * smoothFrac,
      speed: 2.3 + Math.sin(t * Math.PI * 3) * 0.6,
      timestamp: baseTime + i * 20_000,
      accuracy: 5,
    });
  }

  const waypoints: Waypoint[] = [];
  const stats = computeTrackStats(points, waypoints);

  return {
    id: `demo-${Date.now()}`,
    title: 'Balade Mont-Royal & Belvédère',
    dateIso: new Date().toISOString(),
    points,
    waypoints,
    stats,
  };
}

export function createDemoSvgPhotoUrl(title: string, subtitle: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0F172A"/>
        <stop offset="55%" stop-color="#1E3A5F"/>
        <stop offset="100%" stop-color="#F97316"/>
      </linearGradient>
    </defs>
    <rect width="800" height="600" fill="url(#sky)"/>
    <path d="M0 440 L170 290 L320 390 L510 230 L680 350 L800 280 L800 600 L0 600 Z" fill="#090D12" opacity="0.88"/>
    <path d="M0 500 L220 380 L430 470 L640 360 L800 430 L800 600 L0 600 Z" fill="#05070A"/>
    <circle cx="620" cy="145" r="46" fill="#FDBA74" opacity="0.9"/>
    <text x="48" y="520" fill="#FFFFFF" font-family="sans-serif" font-size="30" font-weight="700">${title}</text>
    <text x="48" y="556" fill="#CBD5E1" font-family="sans-serif" font-size="18">${subtitle}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportGpx(session: RecordedSession): string {
  const safeTitle = escapeXml(session.title || 'Track & Field Route');
  const desc = escapeXml(
    `${session.stats.distanceKm.toFixed(2)} km · ${formatDuration(session.stats.durationSec)} · +${session.stats.elevationGainM} m`
  );

  const trkpts = session.points
    .map(
      (pt) =>
        `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}"><ele>${pt.altitude.toFixed(1)}</ele><time>${new Date(pt.timestamp).toISOString()}</time></trkpt>`
    )
    .join('\n');

  const wpts = session.waypoints
    .map(
      (wp) =>
        `  <wpt lat="${wp.lat.toFixed(6)}" lon="${wp.lng.toFixed(6)}"><ele>${wp.altitude.toFixed(1)}</ele><time>${new Date(wp.timestamp).toISOString()}</time><name>${escapeXml(wp.title)}</name><type>${escapeXml(wp.type)}</type></wpt>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Track &amp; Field" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeTitle}</name>
    <desc>${desc}</desc>
    <time>${session.dateIso}</time>
  </metadata>
${wpts ? `${wpts}\n` : ''}  <trk>
    <name>${safeTitle}</name>
    <desc>${desc}</desc>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

export function downloadGpxFile(session: RecordedSession, customTitle?: string): void {
  const target = customTitle ? { ...session, title: customTitle } : session;
  const gpx = exportGpx(target);
  const slug =
    (target.title || 'track-and-field')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'track-and-field';
  const blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
