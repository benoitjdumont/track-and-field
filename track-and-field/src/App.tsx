import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import {
  Camera,
  Download,
  Mic,
  Pause,
  Play,
  Plus,
  Settings,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { MUSIC_TRACKS } from './audio/musicEngine';
import { CreationStudio } from './components/CreationStudio';
import { MapStage } from './components/MapStage';
import { MediaCaptureModal } from './components/MediaCaptureModal';
import { SettingsModal } from './components/SettingsModal';
import { WaypointViewerModal } from './components/WaypointViewerModal';
import { TRANSLATIONS, type Lang } from './i18n/translations';
import type {
  MapSettings,
  RecordedSession,
  TrackPoint,
  Waypoint,
  WaypointType,
} from './types/track';
import {
  computeTrackStats,
  downloadGpxFile,
  formatDuration,
  haversineKm,
  normalizeWaypointProgress,
} from './utils/geo';
import { haptics, isHapticsEnabled, setHapticsEnabled } from './utils/haptics';
import {
  deleteSessionFromPhone,
  listSavedSessionsFromPhone,
  saveSessionToPhone,
} from './utils/storage';
import {
  applyThemeToDom,
  getAccentHex,
  type AccentColorId,
  type ThemeMode,
} from './utils/theme';

type RecordStatus = 'idle' | 'recording' | 'paused';
type AppScreen = 'map' | 'creation';

const DEFAULT_CENTER: [number, number] = [-73.5868, 45.5042];

function readStorage<T extends string>(key: string, fallback: T): T {
  try {
    const val = localStorage.getItem(key);
    return (val as T) || fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(Date.now());

  const [screen, setScreen] = useState<AppScreen>('map');
  const [recordStatus, setRecordStatus] = useState<RecordStatus>('idle');
  const [mapSettings, setMapSettings] = useState<MapSettings>({
    satellite: true,
    buildings3d: true,
    terrain3d: true,
    pitch: 52,
  });

  // Theme, Accent Color, Language & Default Music persisted in localStorage
  const [lang, setLang] = useState<Lang>(() =>
    readStorage<Lang>('tf_lang', 'fr') === 'en' ? 'en' : 'fr'
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readStorage<ThemeMode>('tf_theme_mode', 'auto')
  );
  const [accentColorId, setAccentColorId] = useState<AccentColorId>(() =>
    readStorage<AccentColorId>('tf_accent_color', 'orange')
  );
  const [defaultTrackId, setDefaultTrackId] = useState<string>(() =>
    readStorage('tf_default_track', MUSIC_TRACKS[0].id)
  );
  const [isDarkActive, setIsDarkActive] = useState<boolean>(() =>
    applyThemeToDom(themeMode, accentColorId)
  );

  const [currentCenter, setCurrentCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [livePosition, setLivePosition] = useState<[number, number] | null>(DEFAULT_CENTER);
  const [gpsStatus, setGpsStatus] = useState<'searching' | 'locked' | 'unavailable'>(
    'searching'
  );

  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [activeMs, setActiveMs] = useState(0);

  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [captureMode, setCaptureMode] = useState<WaypointType | null>(null);
  const [inspectWaypoint, setInspectWaypoint] = useState<Waypoint | null>(null);
  const [activeSession, setActiveSession] = useState<RecordedSession | null>(null);
  const [hapticsOn, setHapticsOn] = useState(() => isHapticsEnabled());
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<RecordedSession[]>([]);

  const t = TRANSLATIONS[lang];
  const accentHex = getAccentHex(accentColorId);

  // Persist & apply Theme (Automatic Night Mode + Accent Color) + Language
  useEffect(() => {
    try {
      localStorage.setItem('tf_lang', lang);
      localStorage.setItem('tf_theme_mode', themeMode);
      localStorage.setItem('tf_accent_color', accentColorId);
      localStorage.setItem('tf_default_track', defaultTrackId);
    } catch {
      // ignore storage errors
    }
    document.documentElement.lang = lang;

    const syncTheme = () => {
      setIsDarkActive(applyThemeToDom(themeMode, accentColorId));
    };
    syncTheme();

    const interval = window.setInterval(syncTheme, 60_000);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', syncTheme);

    return () => {
      window.clearInterval(interval);
      mq?.removeEventListener?.('change', syncTheme);
    };
  }, [lang, themeMode, accentColorId, defaultTrackId]);

  // Initial geolocation center check
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGpsStatus('unavailable');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setCurrentCenter(coords);
        setLivePosition(coords);
        setGpsStatus('locked');
        mapRef.current?.flyTo({ center: coords, zoom: 16, duration: 900 });
      },
      () => {
        setGpsStatus('unavailable');
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  }, []);

  // Active recording timer
  useEffect(() => {
    if (recordStatus === 'recording') {
      lastTickRef.current = Date.now();
      timerIntervalRef.current = window.setInterval(() => {
        const now = Date.now();
        const delta = now - lastTickRef.current;
        lastTickRef.current = now;
        setActiveMs((prev) => prev + delta);
      }, 250);
    } else if (timerIntervalRef.current) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    return () => {
      if (timerIntervalRef.current) {
        window.clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [recordStatus]);

  // Real GPS watchPosition when recording
  useEffect(() => {
    if (recordStatus !== 'recording') {
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsStatus('unavailable');
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, altitude, speed, accuracy } = pos.coords;
        if (accuracy && accuracy > 65) return;

        const coords: [number, number] = [longitude, latitude];
        setLivePosition(coords);
        setCurrentCenter(coords);
        setGpsStatus('locked');

        setPoints((prev) => {
          const last = prev[prev.length - 1];
          const now = Date.now();
          const distKm = last ? haversineKm(last, { lat: latitude, lng: longitude }) : 0;
          // Keep a GPS sample every 5 seconds even when stationary. This preserves
          // the real activity timeline without inventing movement or pausing tracking.
          if (last && distKm < 0.004 && now - last.timestamp < 5000) return prev;
          const elapsedSec = last ? Math.max(0.5, (now - last.timestamp) / 1000) : 1;
          const nextPt: TrackPoint = {
            lat: latitude,
            lng: longitude,
            altitude: altitude ?? last?.altitude ?? 120,
            speed: speed ?? (distKm * 1000) / elapsedSec,
            timestamp: now,
            accuracy: accuracy ?? undefined,
          };
          return [...prev, nextPt];
        });
      },
      () => {
        setGpsStatus('unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );

    return () => {
      if (watchIdRef.current !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [recordStatus]);

  const liveStats = computeTrackStats(points, waypoints, activeMs);

  const handleStartRecord = () => {
    haptics.recordStart();
    setPlusMenuOpen(false);
    setSettingsOpen(false);
    if (recordStatus === 'idle') {
      const startCoords = livePosition ?? currentCenter;
      setPoints([
        {
          lat: startCoords[1],
          lng: startCoords[0],
          altitude: 130,
          speed: 0,
          timestamp: Date.now(),
        },
      ]);
      setWaypoints([]);
      setActiveMs(0);
    }
    setRecordStatus('recording');
  };

  const handlePauseResume = () => {
    haptics.pause();
    setPlusMenuOpen(false);
    setRecordStatus((s) => (s === 'recording' ? 'paused' : 'recording'));
  };

  const handleStopAndCreate = () => {
    haptics.stop();
    setPlusMenuOpen(false);
    setSettingsOpen(false);
    setRecordStatus('idle');

    let finalPoints = [...points];
    if (finalPoints.length < 2) {
      const base = finalPoints[0] ?? {
        lat: livePosition?.[1] ?? currentCenter[1],
        lng: livePosition?.[0] ?? currentCenter[0],
        altitude: 130,
        speed: 1.5,
        timestamp: Date.now() - 60_000,
      };
      finalPoints = [
        base,
        {
          ...base,
          lat: base.lat + 0.0014,
          lng: base.lng + 0.0018,
          altitude: base.altitude + 14,
          timestamp: Date.now(),
        },
      ];
    }

    const normalizedWaypoints = normalizeWaypointProgress(finalPoints, waypoints);
    const stats = computeTrackStats(finalPoints, normalizedWaypoints, activeMs);
    const dateLabel = new Date().toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', {
      day: 'numeric',
      month: 'short',
    });
    const session: RecordedSession = {
      id: `track-${Date.now()}`,
      title: lang === 'en' ? `Route · ${dateLabel}` : `Parcours du ${dateLabel}`,
      dateIso: new Date().toISOString(),
      points: finalPoints,
      waypoints: normalizedWaypoints,
      stats,
    };

    setActiveSession(session);
    void saveSessionToPhone(session).catch(() => {});
    setScreen('creation');
  };

  const openSavedTracks = async () => {
    haptics.tap();
    try {
      const list = await listSavedSessionsFromPhone();
      setSavedSessions(list);
    } catch {
      setSavedSessions([]);
    }
    setSavedDrawerOpen(true);
  };

  const handleSaveWaypoint = useCallback(
    (payload: {
      type: WaypointType;
      title: string;
      mediaUrl: string;
      durationSec?: number;
      mimeType?: string;
    }) => {
      const targetPos = livePosition ?? currentCenter;
      const lastPt = points[points.length - 1];
      const newWp: Waypoint = {
        id: `wp-${Date.now()}`,
        type: payload.type,
        lat: targetPos[1],
        lng: targetPos[0],
        altitude: lastPt?.altitude ?? 130,
        timestamp: Date.now(),
        distanceKm: liveStats.distanceKm,
        progress: 0.5,
        title: payload.title,
        mediaUrl: payload.mediaUrl,
        durationSec: payload.durationSec,
        mimeType: payload.mimeType,
      };
      setWaypoints((prev) => [...prev, newWp]);
      setCaptureMode(null);
      setPlusMenuOpen(false);
    },
    [livePosition, currentCenter, points, liveStats.distanceKm]
  );

  const handleRecenter = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          setCurrentCenter(coords);
          setLivePosition(coords);
          setGpsStatus('locked');
          mapRef.current?.flyTo({
            center: coords,
            zoom: 16.2,
            pitch: mapSettings.pitch,
            duration: 750,
          });
        },
        () => {
          mapRef.current?.flyTo({
            center: livePosition ?? currentCenter,
            zoom: 16,
            pitch: mapSettings.pitch,
            duration: 600,
          });
        }
      );
    } else {
      mapRef.current?.flyTo({
        center: livePosition ?? currentCenter,
        zoom: 16,
        pitch: mapSettings.pitch,
        duration: 600,
      });
    }
  };

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-slate-100 dark:bg-[#090D12] select-none">
      {screen === 'creation' && activeSession ? (
        <CreationStudio
          session={activeSession}
          initialMapSettings={mapSettings}
          defaultTrackId={defaultTrackId}
          lang={lang}
          isDark={isDarkActive}
          accentColor={accentHex}
          onUpdateMapSettings={setMapSettings}
          onUpdateTitle={(title) =>
            setActiveSession((prev) => (prev ? { ...prev, title } : prev))
          }
          onOpenSettings={() => setSettingsOpen(true)}
          onBackToMap={() => setScreen('map')}
        />
      ) : (
        <>
          {/* Fullscreen Primary 3D Map */}
          <MapStage
            center={currentCenter}
            zoom={15.8}
            settings={mapSettings}
            points={points}
            livePosition={livePosition}
            waypoints={waypoints}
            accentColor={accentHex}
            isDark={isDarkActive}
            lang={lang}
            onMapReady={(map) => {
              mapRef.current = map;
            }}
            onWaypointClick={(wp) => setInspectWaypoint(wp)}
            onPitchChanged={(pitch) => setMapSettings((s) => ({ ...s, pitch }))}
          />

          {/* Minimal Floating Top Bar (mobile-safe max width) */}
          <header className="pointer-events-none fixed inset-x-0 top-0 z-30 pt-safe px-2.5 sm:px-5 flex items-center justify-between gap-2">
            <div className="pointer-events-auto min-w-0 h-11 px-3 sm:px-3.5 rounded-2xl bg-white/90 dark:bg-slate-950/75 backdrop-blur-xl border border-slate-200 dark:border-white/12 flex items-center gap-2 shadow-lg">
              <span className="font-display text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap truncate">
                {t.appName}
              </span>
              {recordStatus === 'recording' && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-300 whitespace-nowrap shrink-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{t.gpsActive}</span>
                </span>
              )}
            </div>

            <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setSettingsOpen(true);
                  setPlusMenuOpen(false);
                }}
                aria-label={t.settings}
                className="min-h-[44px] px-3 sm:px-3.5 rounded-2xl bg-white/90 dark:bg-slate-950/75 backdrop-blur-xl border border-slate-200 dark:border-white/12 text-slate-900 dark:text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 sm:gap-2 hover:bg-white dark:hover:bg-slate-900 transition-colors shadow-lg whitespace-nowrap"
              >
                <Settings className="w-4 h-4 text-tf-accent shrink-0" />
                <span>{t.settings}</span>
              </button>
            </div>
          </header>

          {/* Bottom Thumb-Zone Controls */}
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 pb-safe px-2.5 sm:px-4 flex flex-col items-center gap-2.5 sm:gap-3">
            {recordStatus !== 'idle' && (
              <div className="pointer-events-auto w-full max-w-md bg-white/90 dark:bg-slate-950/85 backdrop-blur-xl border border-slate-200 dark:border-white/12 rounded-2xl px-3 sm:px-4 py-2 shadow-xl flex items-center justify-between gap-2 text-center">
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block truncate">
                    {recordStatus === 'paused' ? t.pausedLabel : t.durationLabel}
                  </span>
                  <span className="font-mono-tabular text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {formatDuration(activeMs / 1000)}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block truncate">
                    {t.distanceLabel}
                  </span>
                  <span className="font-mono-tabular text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {liveStats.distanceKm.toFixed(2)} km
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block truncate">
                    {t.elevationLabel}
                  </span>
                  <span className="font-mono-tabular text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {liveStats.elevationGainM} m
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 block truncate">
                    {t.waypointsLabel}
                  </span>
                  <span className="font-mono-tabular text-sm sm:text-base font-bold text-tf-accent">
                    {waypoints.length}
                  </span>
                </div>
              </div>
            )}

            {/* '+' Media Action Menu */}
            {plusMenuOpen && (
              <div className="pointer-events-auto max-w-full flex items-center justify-center gap-2 sm:gap-3 bg-white/95 dark:bg-slate-950/90 backdrop-blur-2xl border border-slate-200 dark:border-white/15 rounded-3xl p-2 sm:p-2.5 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    setCaptureMode('photo');
                  }}
                  className="min-w-[74px] sm:min-w-[84px] min-h-[56px] px-2.5 py-2 rounded-2xl bg-slate-100 dark:bg-white/8 hover:bg-tf-accent text-slate-900 dark:text-white hover:text-white flex flex-col items-center justify-center gap-1 transition-colors"
                >
                  <Camera className="w-5 h-5" />
                  <span className="text-xs font-semibold">{t.photo}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    setCaptureMode('video');
                  }}
                  className="min-w-[74px] sm:min-w-[84px] min-h-[56px] px-2.5 py-2 rounded-2xl bg-slate-100 dark:bg-white/8 hover:bg-sky-500 text-slate-900 dark:text-white hover:text-white flex flex-col items-center justify-center gap-1 transition-colors"
                >
                  <Video className="w-5 h-5" />
                  <span className="text-xs font-semibold">{t.video}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    setCaptureMode('voice');
                  }}
                  className="min-w-[74px] sm:min-w-[84px] min-h-[56px] px-2.5 py-2 rounded-2xl bg-slate-100 dark:bg-white/8 hover:bg-emerald-500 text-slate-900 dark:text-white hover:text-white flex flex-col items-center justify-center gap-1 transition-colors"
                >
                  <Mic className="w-5 h-5" />
                  <span className="text-xs font-semibold whitespace-nowrap">{t.voiceNote}</span>
                </button>
              </div>
            )}

            {/* Primary Thumb Action Row */}
            <div className="pointer-events-auto max-w-full mb-2 flex items-center justify-center gap-2 sm:gap-3.5">
              {recordStatus === 'idle' ? (
                <>
                  <button
                    type="button"
                    onClick={handleStartRecord}
                    className="min-h-[54px] sm:min-h-[58px] px-7 sm:px-8 rounded-full bg-tf-accent active:scale-[0.97] text-white font-display text-sm sm:text-base font-bold shadow-2xl flex items-center gap-2.5 transition-all whitespace-nowrap"
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-white" />
                    <span>{t.record}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      setPlusMenuOpen((v) => !v);
                    }}
                    aria-label="+"
                    className={`w-[54px] h-[54px] sm:w-[58px] sm:h-[58px] rounded-full backdrop-blur-xl border flex items-center justify-center shadow-xl transition-all shrink-0 ${
                      plusMenuOpen
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 border-transparent rotate-45'
                        : 'bg-white/95 dark:bg-slate-950/85 text-slate-900 dark:text-white border-slate-200 dark:border-white/18'
                    }`}
                  >
                    <Plus className="w-6 h-6" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handlePauseResume}
                    className="min-h-[52px] sm:min-h-[56px] px-3.5 sm:px-5 rounded-full bg-white/95 dark:bg-slate-950/90 backdrop-blur-xl border border-slate-200 dark:border-white/18 text-slate-900 dark:text-white font-semibold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 active:scale-[0.97] transition-all shadow-xl whitespace-nowrap"
                  >
                    {recordStatus === 'recording' ? (
                      <>
                        <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-current shrink-0" />
                        <span>{t.pause}</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current text-emerald-500 shrink-0" />
                        <span>{t.resume}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleStopAndCreate}
                    className="min-h-[54px] sm:min-h-[58px] px-5 sm:px-7 rounded-full bg-red-600 hover:bg-red-500 active:scale-[0.97] text-white font-display text-sm sm:text-base font-bold shadow-2xl shadow-red-600/35 flex items-center gap-1.5 sm:gap-2 transition-all whitespace-nowrap"
                  >
                    <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current shrink-0" />
                    <span>{t.stop}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      setPlusMenuOpen((v) => !v);
                    }}
                    aria-label="+"
                    className={`w-[52px] h-[52px] sm:w-[56px] sm:h-[56px] rounded-full backdrop-blur-xl border flex items-center justify-center shadow-xl transition-all shrink-0 ${
                      plusMenuOpen
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 border-transparent rotate-45'
                        : 'bg-white/95 dark:bg-slate-950/90 text-slate-900 dark:text-white border-slate-200 dark:border-white/18'
                    }`}
                  >
                    <Plus className="w-6 h-6" />
                  </button>
                </>
              )}
            </div>
          </div>

          {captureMode && (
            <MediaCaptureModal
              mode={captureMode}
              lang={lang}
              onClose={() => setCaptureMode(null)}
              onSave={handleSaveWaypoint}
            />
          )}

          {inspectWaypoint && (
            <WaypointViewerModal
              waypoint={inspectWaypoint}
              lang={lang}
              onClose={() => setInspectWaypoint(null)}
              onDelete={(id) => setWaypoints((prev) => prev.filter((w) => w.id !== id))}
            />
          )}
        </>
      )}

      {/* Unified Settings Modal (accessible from both Map and Creation Mode) */}
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          lang={lang}
          onChangeLang={setLang}
          themeMode={themeMode}
          onChangeThemeMode={setThemeMode}
          isDarkActive={isDarkActive}
          accentColorId={accentColorId}
          onChangeAccentColor={setAccentColorId}
          mapSettings={mapSettings}
          onChangeMapSettings={setMapSettings}
          defaultTrackId={defaultTrackId}
          onChangeDefaultTrackId={setDefaultTrackId}
          hapticsOn={hapticsOn}
          onToggleHaptics={() => {
            const next = !hapticsOn;
            setHapticsOn(next);
            setHapticsEnabled(next);
            if (next) haptics.tap();
          }}
          gpsStatus={gpsStatus}
          onRecenterGps={screen === 'map' ? handleRecenter : undefined}
          onOpenSavedTracks={openSavedTracks}
        />
      )}

      {/* Saved Tracks on Phone Modal */}
      {savedDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setSavedDrawerOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#0F151D] text-slate-900 dark:text-white border border-slate-200 dark:border-white/12 rounded-t-3xl sm:rounded-3xl p-5 pb-safe space-y-4 shadow-2xl max-h-[82dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">{t.savedTracksTitle}</h3>
              <button
                type="button"
                onClick={() => setSavedDrawerOpen(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {savedSessions.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                {t.noSavedTracks}
              </p>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2.5">
                {savedSessions.map((s) => (
                  <div
                    key={s.id}
                    className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-900/75 border border-slate-200 dark:border-white/10 flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setSavedDrawerOpen(false);
                        setActiveSession(s);
                        setScreen('creation');
                      }}
                      className="flex-1 min-w-0 text-left"
                    >
                      <p className="font-display text-sm font-semibold truncate">{s.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular mt-0.5 truncate">
                        {s.stats.distanceKm.toFixed(2)} km · {formatDuration(s.stats.durationSec)} ·{' '}
                        {s.waypoints.length}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={t.exportGpxBtn}
                      title={t.exportGpxBtn}
                      onClick={() => {
                        haptics.success();
                        downloadGpxFile(s);
                      }}
                      className="min-h-[40px] px-2.5 rounded-xl bg-white dark:bg-white/10 text-tf-accent hover:opacity-90 flex items-center gap-1 text-xs font-semibold shrink-0"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>GPX</span>
                    </button>
                    <button
                      type="button"
                      aria-label={t.deleteLabel}
                      onClick={async () => {
                        haptics.warning();
                        await deleteSessionFromPhone(s.id);
                        setSavedSessions((prev) => prev.filter((item) => item.id !== s.id));
                      }}
                      className="min-w-[40px] min-h-[40px] rounded-xl text-slate-500 dark:text-slate-400 hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
