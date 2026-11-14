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

export function computeBestPace(points: TrackPoint[]): string {
  if (points.length < 2) return '--\\'--"';

  const cumulative = getCumulativeDistances(points);
  const totalKm = cumulative[cumulative.length - 1] ?? 0;
  // Use the fastest rolling kilometre; for shorter activities, use 100 m
  // (or the full activity when it is shorter than 100 m).
  const windowKm = totalKm >= 1 ? 1 : Math.min(0.1, totalKm);
  if (windowKm < 0.05) return '--\\'--"';

  let bestSpeedKmh = 0;
  for (let end = 1; end < points.length; end++) {
    const startKm = cumulative[end] - windowKm;
    if (startKm < 0) continue;

    let startTime = points[0].timestamp;
    for (let i = 0; i < end; i++) {
      const segmentKm = cumulative[i + 1] - cumulative[i];
      if (segmentKm <= 0 || startKm > cumulative[i + 1]) continue;
      const fraction = Math.max(0, Math.min(1, (startKm - cumulative[i]) / segmentKm));
      startTime =
        points[i].timestamp + (points[i + 1].timestamp - points[i].timestamp) * fraction;
      break;
    }

    const durationSec = (points[end].timestamp - startTime) / 1000;
    if (durationSec <= 0) continue;
    const speedKmh = (windowKm / durationSec) * 3600;
    if (speedKmh < 120) bestSpeedKmh = Math.max(bestSpeedKmh, speedKmh);
  }

  return formatPace(bestSpeedKmh);
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
      bestPaceMinPerKm: '--\'--"',
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
    if (segKm >= 0.004) distanceKm += segKm;

    const dtSec = Math.max(0.5, (curr.timestamp - prev.timestamp) / 1000);
    const computedKmh = (segKm / dtSec) * 3600;
    const sensorKmh = curr.speed > 0 ? curr.speed * 3.6 : computedKmh;
    if (sensorKmh < 120) {
      maxSpeedKmh = Math.max(maxSpeedKmh, sensorKmh);
    }

    // Ignore altitude sensor jitter while the recorded position is stationary.
    if (segKm >= 0.004) {
      const dAlt = curr.altitude - prev.altitude;
      if (dAlt > 0.6) elevationGainM += dAlt;
      else if (dAlt < -0.6) elevationLossM += Math.abs(dAlt);
    }
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
    bestPaceMinPerKm: computeBestPace(points),
    waypointCount: waypoints.length,
  };
}

export function getCumulativeDistances(points: TrackPoint[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const segmentKm = haversineKm(points[i - 1], points[i]);
    // Match the recorder's 4 m GPS noise threshold so stationary jitter does
    // not inflate route distance, pace, waypoint progress, or elevation charts.
    cum.push(cum[i - 1] + (segmentKm >= 0.004 ? segmentKm : 0));
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
