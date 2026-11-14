export type WaypointType = 'photo' | 'video' | 'voice';

export interface TrackPoint {
  lat: number;
  lng: number;
  altitude: number;
  speed: number; // m/s
  timestamp: number;
  accuracy?: number;
}

export interface Waypoint {
  id: string;
  type: WaypointType;
  lat: number;
  lng: number;
  altitude: number;
  timestamp: number;
  distanceKm: number;
  progress: number; // 0..1 along route
  title: string;
  mediaUrl: string;
  durationSec?: number;
  mimeType?: string;
}

export interface TrackStats {
  distanceKm: number;
  durationSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  elevationGainM: number;
  elevationLossM: number;
  paceMinPerKm: string;
  waypointCount: number;
}

export interface MapSettings {
  satellite: boolean;
  buildings3d: boolean;
  terrain3d: boolean;
  pitch: number; // 0..75 degrees
}

export interface VideoConfig {
  trackId: string;
  fadeInSec: number; // 0..5
  fadeOutSec: number; // 0..5
  videoDurationSec: number; // 15 | 25 | 40 | 60
  aspectRatio: '9:16' | '16:9';
  showStatsOverlay: boolean;
  musicVolume: number; // 0..1
  routeTitle: string;
}

export interface RecordedSession {
  id: string;
  title: string;
  dateIso: string;
  points: TrackPoint[];
  waypoints: Waypoint[];
  stats: TrackStats;
}
