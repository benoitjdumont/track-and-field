import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type * as maplibregl from 'maplibre-gl';
import {
  ArrowLeft,
  BookmarkCheck,
  Building2,
  Camera,
  Check,
  Compass,
  Copy,
  Download,
  Film,
  Image as ImageIcon,
  Layers,
  Mic,
  Mountain,
  Music,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Video,
  Volume2,
} from 'lucide-react';
import { MUSIC_TRACKS, musicEngine } from '../audio/musicEngine';
import { TRANSLATIONS, type Lang } from '../i18n/translations';
import type { MapSettings, RecordedSession, VideoConfig, Waypoint } from '../types/track';
import { downloadGpxFile, formatDuration, getCumulativeDistances, interpolateRouteAt } from '../utils/geo';
import { haptics } from '../utils/haptics';
import { saveSessionToPhone } from '../utils/storage';
import { exportFlyoverVideo, type ExportProgress } from '../utils/videoExporter';
import { MapStage } from './MapStage';
import { WaypointViewerModal } from './WaypointViewerModal';

interface CreationStudioProps {
  session: RecordedSession;
  initialMapSettings: MapSettings;
  defaultTrackId: string;
  lang: Lang;
  isDark: boolean;
  accentColor: string;
  onUpdateMapSettings: (next: MapSettings) => void;
  onUpdateTitle: (title: string) => void;
  onOpenSettings: () => void;
  onBackToMap: () => void;
}

type StudioTab = 'ai' | 'music' | 'waypoints' | 'stats' | 'export';

interface AiRouteAnalysis {
  suggestedTitle: string;
  storySummary: string;
  socialCaption: string;
  coachInsight: string;
  recommendedTrackId: string;
  recommendedTrackReason: string;
}

export const CreationStudio: React.FC<CreationStudioProps> = ({
  session,
  initialMapSettings,
  defaultTrackId,
  lang,
  isDark,
  accentColor,
  onUpdateMapSettings,
  onUpdateTitle,
  onOpenSettings,
  onBackToMap,
}) => {
  const t = TRANSLATIONS[lang];
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const activeVoiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const triggeredWaypointRef = useRef<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [tab, setTab] = useState<StudioTab>('music');
  const [mapSettings, setMapSettings] = useState<MapSettings>(initialMapSettings);
  const [config, setConfig] = useState<VideoConfig>({
    trackId: defaultTrackId || MUSIC_TRACKS[0].id,
    fadeInSec: 1.5,
    fadeOutSec: 2.0,
    videoDurationSec: 25,
    aspectRatio: '9:16',
    showStatsOverlay: true,
    musicVolume: 0.78,
    routeTitle: session.title,
  });

  // Sync map settings if updated from Settings modal
  useEffect(() => {
    setMapSettings(initialMapSettings);
  }, [initialMapSettings]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 overall video timeline
  const [previewingTrackId, setPreviewingTrackId] = useState<string | null>(null);
  const [loadingTrackId, setLoadingTrackId] = useState<string | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<Waypoint | null>(null);

  const [exportState, setExportState] = useState<ExportProgress | null>(null);
  const [exportedVideo, setExportedVideo] = useState<{
    url: string;
    blob: Blob;
    extension: string;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);

  // Phone save state
  const [savingToPhone, setSavingToPhone] = useState(false);
  const [savedToPhone, setSavedToPhone] = useState(false);
  const [gpxExportedToast, setGpxExportedToast] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [snapshotBlob, setSnapshotBlob] = useState<Blob | null>(null);

  // AI Coach & Story state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiRouteAnalysis | null>(null);

  const updateSettings = (patch: Partial<MapSettings>) => {
    haptics.tap();
    const next = { ...mapSettings, ...patch };
    setMapSettings(next);
    onUpdateMapSettings(next);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      musicEngine.stop(0.1);
      activeVoiceAudioRef.current?.pause();
      exportAbortRef.current?.abort();
    };
  }, []);

  // Exact Fade In (audio priority) -> Map Flyover -> Map Video Fade Out -> Final Stats Outro + Music Fade Out
  const timelineMeta = useMemo(() => {
    const totalSec = config.videoDurationSec;
    const fadeIn = Math.min(config.fadeInSec, totalSec * 0.35);
    const fadeOut = Math.min(config.fadeOutSec, totalSec * 0.3);
    const outroSec = Math.max(3.5, Math.min(totalSec * 0.34, fadeOut + 2.0));
    const flyoverSec = Math.max(4, totalSec - outroSec);
    const videoFadeDelay = fadeIn > 0.2 ? Math.min(0.65, fadeIn * 0.4) : 0;
    return { totalSec, fadeIn, fadeOut, outroSec, flyoverSec, videoFadeDelay };
  }, [config.videoDurationSec, config.fadeInSec, config.fadeOutSec]);

  const elapsedSec = progress * timelineMeta.totalSec;
  const routeProgress = Math.min(1, elapsedSec / timelineMeta.flyoverSec);

  const currentFlyover = useMemo(
    () => interpolateRouteAt(session.points, routeProgress),
    [session.points, routeProgress]
  );

  const activeWaypoint = useMemo(() => {
    if (elapsedSec >= timelineMeta.flyoverSec) return null;
    return session.waypoints.find((w) => Math.abs(w.progress - routeProgress) < 0.048) ?? null;
  }, [session.waypoints, routeProgress, elapsedSec, timelineMeta.flyoverSec]);

  useEffect(() => {
    if (!isPlaying || !activeWaypoint || activeWaypoint.type !== 'voice') {
      if (activeVoiceAudioRef.current && (!isPlaying || !activeWaypoint)) {
        activeVoiceAudioRef.current.pause();
        activeVoiceAudioRef.current = null;
        musicEngine.setVolume(config.musicVolume);
      }
      if (!activeWaypoint) triggeredWaypointRef.current = null;
      return;
    }

    if (triggeredWaypointRef.current !== activeWaypoint.id) {
      triggeredWaypointRef.current = activeWaypoint.id;
      activeVoiceAudioRef.current?.pause();
      const audio = new Audio(activeWaypoint.mediaUrl);
      activeVoiceAudioRef.current = audio;
      musicEngine.setVolume(config.musicVolume * 0.25);
      audio.onended = () => {
        musicEngine.setVolume(config.musicVolume);
      };
      void audio.play().catch(() => {});
    }
  }, [isPlaying, activeWaypoint, config.musicVolume]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    lastFrameRef.current = performance.now();
    const tick = (now: number) => {
      const dtSec = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;

      setProgress((prev) => {
        const next = prev + dtSec / timelineMeta.totalSec;
        if (next >= 1) {
          setIsPlaying(false);
          musicEngine.stop(0.25);
          setPreviewingTrackId(null);
          haptics.tap();
          return 1;
        }

        const elSec = next * timelineMeta.totalSec;
        let volFactor = 1;
        // Priority Audio Fade In right from t=0
        if (timelineMeta.fadeIn > 0.05 && elSec < timelineMeta.fadeIn) {
          volFactor = Math.min(volFactor, Math.max(0.02, elSec / timelineMeta.fadeIn));
        }
        // Music stays up during video fade-out and fades out AFTER the video during Final Stats Outro
        if (elSec >= timelineMeta.flyoverSec) {
          volFactor = Math.min(
            volFactor,
            Math.max(0, (timelineMeta.totalSec - elSec) / timelineMeta.outroSec)
          );
        }
        if (!activeWaypoint || activeWaypoint.type !== 'voice') {
          musicEngine.setVolume(config.musicVolume * volFactor);
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, timelineMeta, config.musicVolume, activeWaypoint]);

  const togglePlayFlyover = async () => {
    haptics.tap();
    if (isPlaying) {
      setIsPlaying(false);
      musicEngine.stop(0.2);
      setPreviewingTrackId(null);
      return;
    }

    if (progress >= 0.99) setProgress(0);
    setLoadingTrackId(config.trackId);
    try {
      await musicEngine.playPreview(
        config.trackId,
        timelineMeta.fadeIn > 0.2 ? 0.02 : config.musicVolume,
        Math.min(1.5, timelineMeta.fadeIn)
      );
      setPreviewingTrackId(config.trackId);
    } finally {
      setLoadingTrackId(null);
    }
    setIsPlaying(true);
  };

  const handleTrackSelectAndPreview = async (trackId: string) => {
    haptics.tap();
    setConfig((c) => ({ ...c, trackId }));
    if (previewingTrackId === trackId && !isPlaying) {
      musicEngine.stop(0.15);
      setPreviewingTrackId(null);
      return;
    }
    setLoadingTrackId(trackId);
    try {
      await musicEngine.playPreview(trackId, config.musicVolume, 0.25);
      setPreviewingTrackId(trackId);
    } finally {
      setLoadingTrackId(null);
    }
  };

  // Visual opacity of black intro curtain and final stats outro card
  const { introCurtainOpacity, outroOpacity } = useMemo(() => {
    if (!isPlaying && progress === 0) {
      return { introCurtainOpacity: 0, outroOpacity: 0 };
    }
    let introAlpha = 0;
    if (timelineMeta.fadeIn > 0.05) {
      const videoInElapsed = elapsedSec - timelineMeta.videoFadeDelay;
      if (videoInElapsed <= 0) {
        introAlpha = 1;
      } else if (videoInElapsed < timelineMeta.fadeIn) {
        introAlpha = 1 - videoInElapsed / timelineMeta.fadeIn;
      }
    }

    let outroAlpha = 0;
    if (elapsedSec >= timelineMeta.flyoverSec) {
      outroAlpha = 1;
    } else if (
      timelineMeta.fadeOut > 0.05 &&
      elapsedSec > timelineMeta.flyoverSec - timelineMeta.fadeOut
    ) {
      outroAlpha =
        (elapsedSec - (timelineMeta.flyoverSec - timelineMeta.fadeOut)) / timelineMeta.fadeOut;
    }

    return {
      introCurtainOpacity: Math.max(0, Math.min(1, introAlpha)),
      outroOpacity: Math.max(0, Math.min(1, outroAlpha)),
    };
  }, [isPlaying, progress, elapsedSec, timelineMeta]);

  const elevationData = useMemo(() => {
    const distances = getCumulativeDistances(session.points);
    return session.points.map((point, index) => ({
      distanceKm: Number((distances[index] ?? 0).toFixed(3)),
      altitude: Math.round(point.altitude),
    }));
  }, [session.points]);

  const paceGaugePercent = useMemo(() => {
    const toSeconds = (pace: string | undefined) => {
      const match = /^(\\d+)'(\\d{2})"/.exec(pace ?? '');
      return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
    };
    const average = toSeconds(session.stats.paceMinPerKm);
    const best = toSeconds(session.stats.bestPaceMinPerKm);
    return average > 0 && best > 0 ? Math.max(0, Math.min(100, (best / average) * 100)) : 0;
  }, [session.stats.paceMinPerKm, session.stats.bestPaceMinPerKm]);

  const handleAnalyzeWithAI = async () => {
    haptics.tap();
    setAiLoading(true);
    setAiError(null);

    try {
      const photoDataUrls = session.waypoints
        .filter((w) => w.type === 'photo' && w.mediaUrl.startsWith('data:image/'))
        .slice(0, 2)
        .map((w) => w.mediaUrl);

      const response = await fetch('/api/ai/analyze-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang,
          title: config.routeTitle,
          stats: session.stats,
          waypoints: session.waypoints.map((w) => ({
            type: w.type,
            title: w.title,
            distanceKm: w.distanceKm,
            altitude: w.altitude,
          })),
          photoDataUrls,
          availableTracks: MUSIC_TRACKS.map((tItem) => ({
            id: tItem.id,
            title: tItem.title,
            genre: tItem.genre,
            mood: tItem.mood,
            bpm: tItem.bpm,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'AI service error.');
      }

      setAiResult(data as AiRouteAnalysis);
      haptics.success();
    } catch (err) {
      haptics.warning();
      setAiError(err instanceof Error ? err.message : 'AI analysis error.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveRouteOnPhone = async () => {
    haptics.tap();
    setSavingToPhone(true);
    try {
      await saveSessionToPhone({ ...session, title: config.routeTitle });
      setSavedToPhone(true);
      haptics.success();
      window.setTimeout(() => setSavedToPhone(false), 2600);
    } finally {
      setSavingToPhone(false);
    }
  };

  const handleCreateMapSnapshot = async () => {
    haptics.tap();
    const mapCanvas = mapCanvasRef.current;
    if (!mapCanvas) return;

    const width = 1080;
    const height = config.aspectRatio === '9:16' ? 1920 : 1080;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#090D12';
    ctx.fillRect(0, 0, width, height);

    const scale = Math.max(width / (mapCanvas.width || 1), height / (mapCanvas.height || 1));
    const dw = mapCanvas.width * scale;
    const dh = mapCanvas.height * scale;
    ctx.drawImage(mapCanvas, (width - dw) / 2, (height - dh) / 2, dw, dh);

    const botGrad = ctx.createLinearGradient(0, height - 380, 0, height);
    botGrad.addColorStop(0, 'rgba(9,13,18,0)');
    botGrad.addColorStop(1, 'rgba(9,13,18,0.95)');
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, height - 380, width, 380);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 44px Outfit, sans-serif';
    ctx.fillText(config.routeTitle || session.title, 48, height - 220);

    ctx.fillStyle = accentColor;
    ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('TRACK & FIELD', 48, height - 275);

    const cols = [
      { label: t.distanceLabel.toUpperCase(), val: `${session.stats.distanceKm.toFixed(2)} km` },
      { label: t.durationLabel.toUpperCase(), val: formatDuration(session.stats.durationSec) },
      { label: t.elevationLabel.toUpperCase(), val: `+${session.stats.elevationGainM} m` },
      { label: t.paceLabel.toUpperCase(), val: `${session.stats.paceMinPerKm}` },
    ];
    const colW = (width - 96) / cols.length;
    cols.forEach((c, idx) => {
      const x = 48 + idx * colW;
      ctx.fillStyle = '#94A3B8';
      ctx.font = '600 18px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(c.label, x, height - 130);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 34px "JetBrains Mono", monospace';
      ctx.fillText(c.val, x, height - 84);
    });

    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setSnapshotBlob(blob);
      setSnapshotUrl(url);
      haptics.success();

      const a = document.createElement('a');
      a.href = url;
      a.download = `${config.routeTitle.toLowerCase().replace(/\s+/g, '-')}-card.png`;
      a.click();
    }, 'image/png');
  };

  const handleStartExport = async () => {
    haptics.tap();
    if (!mapInstanceRef.current || !mapCanvasRef.current) {
      setExportError(
        lang === 'en'
          ? '3D map is loading, please try again in a moment.'
          : 'Carte 3D en cours de chargement, réessayez dans un instant.'
      );
      return;
    }
    setIsPlaying(false);
    musicEngine.stop(0.1);
    setPreviewingTrackId(null);
    setExportError(null);
    setExportedVideo(null);
    setExportState({ progress: 0.01, phase: 'audio' });

    const abort = new AbortController();
    exportAbortRef.current = abort;

    try {
      const res = await exportFlyoverVideo({
        session,
        config,
        map: mapInstanceRef.current,
        mapCanvas: mapCanvasRef.current,
        pitch: mapSettings.pitch,
        accentColor,
        lang,
        onSyncProgress: (routeP) => {
          const flyFraction = timelineMeta.flyoverSec / timelineMeta.totalSec;
          setProgress(routeP * flyFraction);
        },
        onProgress: (st) => setExportState(st),
        signal: abort.signal,
      });

      const url = URL.createObjectURL(res.blob);
      setExportedVideo({ url, blob: res.blob, extension: res.extension });
      setExportState(null);
      haptics.success();
    } catch (err) {
      setExportState(null);
      haptics.warning();
      setExportError(
        err instanceof Error
          ? err.message
          : lang === 'en'
            ? 'Video export failed.'
            : 'Erreur lors de la création vidéo.'
      );
    }
  };

  const shareSummaryText =
    aiResult?.socialCaption ||
    `${config.routeTitle} — ${session.stats.distanceKm.toFixed(2)} km · ${formatDuration(session.stats.durationSec)} · +${session.stats.elevationGainM} m · Track & Field`;

  const handleNativeShare = async (preferImage = false) => {
    haptics.tap();
    if (!preferImage && exportedVideo && navigator.canShare) {
      const file = new File(
        [exportedVideo.blob],
        `track-and-field.${exportedVideo.extension}`,
        { type: exportedVideo.blob.type }
      );
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: config.routeTitle,
            text: shareSummaryText,
            files: [file],
          });
          haptics.success();
          return;
        } catch {
          // fallback below
        }
      }
    }

    if (snapshotBlob && navigator.canShare) {
      const imgFile = new File([snapshotBlob], 'track-and-field-card.png', {
        type: 'image/png',
      });
      if (navigator.canShare({ files: [imgFile] })) {
        try {
          await navigator.share({
            title: config.routeTitle,
            text: shareSummaryText,
            files: [imgFile],
          });
          haptics.success();
          return;
        } catch {
          // fallback below
        }
      }
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: config.routeTitle,
          text: shareSummaryText,
          url: window.location.href,
        });
        haptics.success();
        return;
      } catch {
        // user cancelled
      }
    }
    handleCopySummary();
  };

  const handleCopySummary = () => {
    haptics.tap();
    void navigator.clipboard?.writeText(`${shareSummaryText}\n${window.location.href}`);
    setCopiedSummary(true);
    window.setTimeout(() => setCopiedSummary(false), 2200);
  };

  const handleDownloadGpx = () => {
    haptics.success();
    downloadGpxFile(session, config.routeTitle);
    setGpxExportedToast(true);
    window.setTimeout(() => setGpxExportedToast(false), 2400);
  };

  const activeTrack = MUSIC_TRACKS.find((item) => item.id === config.trackId) ?? MUSIC_TRACKS[0];
  const aiRecommendedTrack = aiResult
    ? MUSIC_TRACKS.find((item) => item.id === aiResult.recommendedTrackId)
    : undefined;

  return (
    <div className="h-[100dvh] w-full max-w-full bg-slate-50 dark:bg-[#090D12] text-slate-900 dark:text-slate-100 flex flex-col overflow-hidden">
      {/* Compact Phone-Safe Top Bar */}
      <header className="min-h-[54px] shrink-0 px-2.5 sm:px-6 py-1.5 border-b border-slate-200 dark:border-white/10 bg-white/95 dark:bg-[#090D12]/95 flex items-center justify-between gap-1.5 sm:gap-3 pt-safe">
        <button
          type="button"
          onClick={() => {
            haptics.tap();
            musicEngine.stop(0.1);
            onBackToMap();
          }}
          className="min-h-[42px] px-2.5 sm:px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>{t.mapBack}</span>
        </button>

        <input
          type="text"
          value={config.routeTitle}
          onChange={(e) => {
            setConfig((c) => ({ ...c, routeTitle: e.target.value }));
            onUpdateTitle(e.target.value);
          }}
          aria-label="Title"
          className="flex-1 min-w-0 w-full max-w-sm bg-transparent text-center font-display text-sm sm:text-base font-semibold border-b border-transparent focus:border-tf-accent focus:outline-none truncate px-1.5 py-1"
        />

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              haptics.tap();
              onOpenSettings();
            }}
            aria-label={t.settings}
            className="min-w-[42px] min-h-[42px] rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 inline-flex items-center justify-center transition-colors shrink-0"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              haptics.tap();
              setTab('export');
            }}
            aria-label={t.share}
            className="min-h-[40px] px-3 sm:px-3.5 rounded-xl bg-tf-accent text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Share2 className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">{t.share}</span>
          </button>
        </div>
      </header>

      {/* Main Studio Body */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-12 overflow-hidden">
        {/* LEFT / TOP: 3D Flyover Video Preview Stage */}
        <div className="relative h-[38dvh] sm:h-[44dvh] lg:h-full lg:col-span-7 bg-slate-950 flex items-center justify-center overflow-hidden border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-white/10 shrink-0">
          <div
            className={`relative h-full transition-all duration-300 overflow-hidden ${
              config.aspectRatio === '9:16'
                ? 'w-full lg:w-[min(100%,430px)] lg:h-[min(92%,760px)] lg:rounded-3xl lg:border lg:border-white/15 lg:shadow-2xl'
                : 'w-full h-full'
            }`}
          >
            <MapStage
              center={[currentFlyover.lng, currentFlyover.lat]}
              zoom={15.7}
              bearing={currentFlyover.bearing * 0.35}
              settings={mapSettings}
              points={session.points}
              activeProgressCoords={currentFlyover.partialCoords}
              livePosition={[currentFlyover.lng, currentFlyover.lat]}
              followTarget={[currentFlyover.lng, currentFlyover.lat]}
              waypoints={session.waypoints}
              highlightedWaypointId={activeWaypoint?.id ?? null}
              accentColor={accentColor}
              isDark={isDark}
              lang={lang}
              onMapReady={(map, canvas) => {
                mapInstanceRef.current = map;
                mapCanvasRef.current = canvas;
              }}
              onWaypointClick={(wp) => {
                haptics.tap();
                setSelectedWaypoint(wp);
              }}
              onPitchChanged={(pitch) => updateSettings({ pitch })}
            />

            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/75 via-black/30 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/85 via-black/45 to-transparent" />

            <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => updateSettings({ satellite: !mapSettings.satellite })}
                className={`min-h-[38px] px-2.5 rounded-lg text-xs font-medium backdrop-blur-md border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                  mapSettings.satellite
                    ? 'bg-tf-accent border-tf-accent text-white'
                    : 'bg-slate-950/75 border-white/15 text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{t.satellite}</span>
              </button>
              <button
                type="button"
                onClick={() => updateSettings({ buildings3d: !mapSettings.buildings3d })}
                className={`min-h-[38px] px-2.5 rounded-lg text-xs font-medium backdrop-blur-md border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                  mapSettings.buildings3d
                    ? 'bg-sky-500 border-sky-400 text-white'
                    : 'bg-slate-950/75 border-white/15 text-slate-200'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>3D</span>
              </button>
            </div>

            {activeWaypoint && outroOpacity < 0.3 && (
              <div className="absolute inset-x-4 bottom-24 z-20 flex justify-center pointer-events-auto">
                <button
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    setSelectedWaypoint(activeWaypoint);
                  }}
                  className="w-full max-w-xs bg-[#0F151D]/92 backdrop-blur-xl border border-white/18 rounded-2xl p-2.5 shadow-2xl flex items-center gap-3 text-left"
                >
                  {activeWaypoint.type === 'photo' ? (
                    <img
                      src={activeWaypoint.mediaUrl}
                      alt={activeWaypoint.title}
                      className="w-16 h-16 rounded-xl object-cover shrink-0"
                    />
                  ) : activeWaypoint.type === 'video' ? (
                    <video
                      src={activeWaypoint.mediaUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="w-16 h-16 rounded-xl object-cover shrink-0 bg-black"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
                      <Mic className="w-6 h-6 text-emerald-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm font-semibold text-white truncate">
                      {activeWaypoint.title}
                    </p>
                    <p className="text-xs text-slate-400 font-mono-tabular mt-0.5">
                      {activeWaypoint.distanceKm.toFixed(2)} km ·{' '}
                      {Math.round(activeWaypoint.altitude)} m
                    </p>
                  </div>
                </button>
              </div>
            )}

            {config.showStatsOverlay && outroOpacity < 0.6 && (
              <div className="pointer-events-none absolute inset-x-4 bottom-16 z-10 flex items-center justify-between text-xs text-white">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                    {t.distanceLabel}
                  </span>
                  <span className="font-mono-tabular text-sm font-bold">
                    {currentFlyover.distanceKm.toFixed(2)} km
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                    {t.durationLabel}
                  </span>
                  <span className="font-mono-tabular text-sm font-bold">
                    {formatDuration(Math.round(routeProgress * session.stats.durationSec))}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                    {t.altitudeLabel}
                  </span>
                  <span className="font-mono-tabular text-sm font-bold">
                    {Math.round(currentFlyover.altitude)} m
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                    {t.elevationLabel}
                  </span>
                  <span className="font-mono-tabular text-sm font-bold">
                    {session.stats.elevationGainM} m
                  </span>
                </div>
              </div>
            )}

            {/* Intro audio-first black curtain */}
            {introCurtainOpacity > 0.01 && (
              <div
                className="pointer-events-none absolute inset-0 z-20 bg-[#090D12]"
                style={{ opacity: introCurtainOpacity }}
              />
            )}

            {/* Final Stats Outro Card: map fades out into this readable summary while music fades out AFTER */}
            {outroOpacity > 0.01 && (
              <div
                className="pointer-events-none absolute inset-0 z-20 bg-[#090D12] flex items-center justify-center p-2.5 pb-16 sm:p-4 sm:pb-20"
                style={{ opacity: outroOpacity }}
              >
                <div
                  className="w-full max-w-sm max-h-full overflow-y-auto rounded-2xl sm:rounded-3xl bg-[#0F151D] border-2 p-3 sm:p-5 space-y-2 sm:space-y-3 shadow-2xl"
                  style={{ borderColor: accentColor }}
                >
                  <div>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider block"
                      style={{ color: accentColor }}
                    >
                      Track &amp; Field · {t.finalStatsTitle}
                    </span>
                    <h3 className="font-display text-sm sm:text-lg font-bold text-white truncate mt-0.5">
                      {config.routeTitle || session.title}
                    </h3>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-2 gap-1.5 sm:gap-2">
                    {[
                      { label: t.distanceLabel, value: `${session.stats.distanceKm.toFixed(2)} km` },
                      { label: t.durationLabel, value: formatDuration(session.stats.durationSec) },
                      { label: t.elevationLabel, value: `+${session.stats.elevationGainM} m` },
                      { label: t.avgSpeedLabel, value: `${session.stats.avgSpeedKmh.toFixed(1)} km/h` },
                      { label: t.paceLabel, value: `${session.stats.paceMinPerKm}` },
                      { label: t.waypointsLabel, value: `${session.waypoints.length}` },
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl bg-white/5 px-2 py-1.5 sm:px-3 sm:py-2 min-w-0">
                        <span className="text-[9px] sm:text-[10px] text-slate-400 block truncate">
                          {s.label}
                        </span>
                        <span className="font-mono-tabular text-xs sm:text-sm font-bold text-white truncate block">
                          {s.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Playback Controls Bar */}
            <div className="absolute inset-x-2.5 sm:inset-x-3 bottom-2 z-30 flex items-center gap-2 bg-slate-950/85 backdrop-blur-lg border border-white/12 rounded-2xl px-2.5 py-1">
              <button
                type="button"
                onClick={togglePlayFlyover}
                aria-label={isPlaying ? t.pause : 'Play 3D video'}
                className="min-w-[38px] min-h-[38px] rounded-xl bg-tf-accent text-white flex items-center justify-center transition-colors shrink-0"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <div className="relative flex-1 min-w-0 flex items-center h-8">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.002}
                  value={progress}
                  onChange={(e) => setProgress(parseFloat(e.target.value))}
                  aria-label="Video timeline"
                  className="tf-slider w-full"
                />
                {session.waypoints.map((wp) => {
                  const overallWpPos =
                    (wp.progress * timelineMeta.flyoverSec) / timelineMeta.totalSec;
                  return (
                    <button
                      key={wp.id}
                      type="button"
                      title={wp.title}
                      onClick={() => {
                        haptics.tap();
                        setProgress(overallWpPos);
                      }}
                      style={{
                        left: `${overallWpPos * 100}%`,
                        backgroundColor:
                          wp.type === 'photo'
                            ? accentColor
                            : wp.type === 'video'
                              ? '#38BDF8'
                              : '#34D399',
                      }}
                      className="absolute -top-1 -translate-x-1/2 w-3 h-3 rounded-full border border-white shadow"
                    />
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setIsPlaying(false);
                  musicEngine.stop(0.1);
                  setProgress(0);
                }}
                aria-label="Restart"
                className="min-w-[36px] min-h-[36px] rounded-lg text-slate-300 hover:bg-white/10 flex items-center justify-center shrink-0"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT / BOTTOM: Creation Mode Studio Panel */}
        <div className="flex-1 min-h-0 lg:col-span-5 flex flex-col bg-white dark:bg-[#0C1118] overflow-hidden">
          {/* Segmented Studio Tabs (stack icon + label on phone so zero horizontal overflow) */}
          <div className="px-2 sm:px-3 py-2 border-b border-slate-200 dark:border-white/10 grid grid-cols-5 gap-1 bg-slate-100/90 dark:bg-[#090D12]/80 shrink-0">
            {[
              { id: 'ai' as const, label: t.tabAi, icon: Sparkles },
              { id: 'music' as const, label: t.tabMusic, icon: Music },
              { id: 'waypoints' as const, label: t.tabWaypoints, icon: Camera },
              { id: 'stats' as const, label: t.tabStats, icon: TrendingUp },
              { id: 'export' as const, label: t.tabShare, icon: Film },
            ].map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    setTab(item.id);
                  }}
                  className={`min-w-0 min-h-[46px] sm:min-h-[42px] px-1 py-1 sm:py-0 rounded-xl text-[10px] sm:text-xs font-semibold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-tf-accent text-white'
                      : 'bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-full">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Content Area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-3.5 sm:p-5 pb-safe space-y-5">
            {tab === 'ai' && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-display text-base font-semibold">{t.aiHeading}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t.aiSubheading}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={handleAnalyzeWithAI}
                  className="w-full min-h-[48px] rounded-2xl bg-tf-accent disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg"
                >
                  {aiLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      <span>{t.aiAnalyzing}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>{aiResult ? t.aiReanalyzeBtn : t.aiAnalyzeBtn}</span>
                    </>
                  )}
                </button>

                {aiError && (
                  <p className="text-xs text-red-500 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    {aiError}
                  </p>
                )}

                {aiResult && (
                  <div className="space-y-3.5">
                    <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/75 border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                          {t.aiSuggestedTitle}
                        </span>
                        <p className="font-display text-base font-semibold truncate mt-0.5">
                          {aiResult.suggestedTitle}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          haptics.success();
                          setConfig((c) => ({ ...c, routeTitle: aiResult.suggestedTitle }));
                          onUpdateTitle(aiResult.suggestedTitle);
                        }}
                        className="min-h-[40px] px-3.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-950 text-xs font-semibold shrink-0"
                      >
                        {t.apply}
                      </button>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/75 border border-slate-200 dark:border-white/10 space-y-1.5">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                        {t.aiStory}
                      </span>
                      <p className="text-sm leading-relaxed">{aiResult.storySummary}</p>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/75 border border-slate-200 dark:border-white/10 space-y-1.5">
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium block">
                        {t.aiCoach}
                      </span>
                      <p className="text-sm leading-relaxed">{aiResult.coachInsight}</p>
                    </div>

                    {aiRecommendedTrack && (
                      <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/75 border border-slate-200 dark:border-white/10 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                            {t.aiMusicRec}
                          </span>
                          <p className="font-display text-sm font-semibold truncate mt-0.5">
                            {aiRecommendedTrack.title} · {aiRecommendedTrack.bpm} BPM
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {aiResult.recommendedTrackReason}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleTrackSelectAndPreview(aiRecommendedTrack.id)}
                          className="min-h-[40px] px-3.5 rounded-xl bg-tf-accent text-white text-xs font-semibold shrink-0"
                        >
                          {t.listen}
                        </button>
                      </div>
                    )}

                    <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/75 border border-slate-200 dark:border-white/10 space-y-3">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                        {t.aiSocialCaption}
                      </span>
                      <p className="text-xs leading-relaxed whitespace-pre-line">
                        {aiResult.socialCaption}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={handleCopySummary}
                          className="min-h-[40px] rounded-xl bg-slate-200/80 dark:bg-white/8 text-xs font-semibold flex items-center justify-center gap-1.5"
                        >
                          {copiedSummary ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedSummary ? t.copied : t.copy}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleNativeShare()}
                          className="min-h-[40px] rounded-xl bg-tf-accent text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>{t.share}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'music' && (
              <>
                <div>
                  <h2 className="font-display text-base font-semibold">{t.musicHeading}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t.musicSubheading}
                  </p>
                </div>

                <div className="bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10 rounded-2xl p-4 space-y-3.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium inline-flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-tf-accent" />
                      {t.musicVolume}
                    </span>
                    <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                      {Math.round(config.musicVolume * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={config.musicVolume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setConfig((c) => ({ ...c, musicVolume: v }));
                      musicEngine.setVolume(v);
                    }}
                    className="tf-slider w-full"
                  />

                  <div className="grid grid-cols-2 gap-4 pt-1">
                    <div>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span>{t.fadeIn}</span>
                        <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                          {config.fadeInSec.toFixed(1)}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={0.5}
                        value={config.fadeInSec}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, fadeInSec: parseFloat(e.target.value) }))
                        }
                        className="tf-slider w-full"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span>{t.fadeOut}</span>
                        <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                          {config.fadeOutSec.toFixed(1)}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={0.5}
                        value={config.fadeOutSec}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, fadeOutSec: parseFloat(e.target.value) }))
                        }
                        className="tf-slider w-full"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t.fadeSequenceHint}
                  </p>
                </div>

                <div className="space-y-2">
                  {MUSIC_TRACKS.map((track, idx) => {
                    const selected = config.trackId === track.id;
                    const playing = previewingTrackId === track.id;
                    const loading = loadingTrackId === track.id;
                    return (
                      <button
                        key={track.id}
                        type="button"
                        onClick={() => handleTrackSelectAndPreview(track.id)}
                        className={`w-full min-h-[60px] px-3.5 py-2.5 rounded-2xl border text-left flex items-center gap-3 transition-colors ${
                          selected
                            ? 'bg-slate-100 dark:bg-white/10 border-tf-accent'
                            : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/8 hover:bg-slate-100 dark:hover:bg-white/8'
                        }`}
                      >
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white font-semibold"
                          style={{
                            backgroundColor: playing ? track.accentColor : '#334155',
                          }}
                        >
                          {loading ? (
                            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          ) : playing ? (
                            <Pause className="w-4 h-4 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 fill-current ml-0.5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-display text-sm font-semibold truncate">
                              {String(idx + 1).padStart(2, '0')}. {track.title}
                            </span>
                            <span className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                              {track.bpm} BPM
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {track.genre} · {track.mood} · {track.keyLabel}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {tab === 'waypoints' && (
              <div className="space-y-3">
                <div>
                  <h2 className="font-display text-base font-semibold">
                    {t.tabWaypoints} ({session.waypoints.length})
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {lang === 'en'
                      ? 'Each photo, video, and voice note pops up on the map as the route passes by.'
                      : 'Chaque photo, vidéo et note vocale s’affiche automatiquement au passage sur la carte.'}
                  </p>
                </div>

                {session.waypoints.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-white/8 text-center">
                    <p className="text-sm">
                      {lang === 'en'
                        ? 'No markers captured during this route.'
                        : 'Aucun point de repère capturé pendant ce parcours.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {session.waypoints.map((wp) => (
                      <div
                        key={wp.id}
                        className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-900/65 border border-slate-200 dark:border-white/10 flex items-center gap-3"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            haptics.tap();
                            setProgress(
                              (wp.progress * timelineMeta.flyoverSec) / timelineMeta.totalSec
                            );
                          }}
                          className="w-12 h-12 rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0"
                        >
                          {wp.type === 'photo' ? (
                            <img
                              src={wp.mediaUrl}
                              alt={wp.title}
                              className="w-full h-full object-cover"
                            />
                          ) : wp.type === 'video' ? (
                            <Video className="w-5 h-5 text-sky-500" />
                          ) : (
                            <Mic className="w-5 h-5 text-emerald-500" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="font-display text-sm font-semibold truncate">{wp.title}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular mt-0.5">
                            {wp.type === 'photo'
                              ? t.photo
                              : wp.type === 'video'
                                ? t.video
                                : t.voiceNote}{' '}
                            · {wp.distanceKm.toFixed(2)} km · {Math.round(wp.altitude)} m
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            haptics.tap();
                            setProgress(
                              (wp.progress * timelineMeta.flyoverSec) / timelineMeta.totalSec
                            );
                            setSelectedWaypoint(wp);
                          }}
                          className="min-h-[40px] px-3 rounded-xl bg-slate-200 dark:bg-white/8 text-xs font-medium shrink-0"
                        >
                          {t.see}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'stats' && (
              <div className="space-y-4">
                <h2 className="font-display text-base font-semibold">{t.statsHeading}</h2>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: t.distanceLabel, value: `${session.stats.distanceKm.toFixed(2)} km` },
                    { label: t.durationLabel, value: formatDuration(session.stats.durationSec) },
                    { label: t.avgSpeedLabel, value: `${session.stats.avgSpeedKmh.toFixed(1)} km/h` },
                    { label: t.maxSpeedLabel, value: `${session.stats.maxSpeedKmh.toFixed(1)} km/h` },
                    { label: t.elevationLabel, value: `+${session.stats.elevationGainM} m` },
                    { label: t.paceLabel, value: `${session.stats.paceMinPerKm} /km` },
                    { label: t.bestPaceLabel, value: `${session.stats.bestPaceMinPerKm ?? '--\\'--"'} /km` },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10"
                    >
                      <span className="text-xs text-slate-500 dark:text-slate-400 block">
                        {stat.label}
                      </span>
                      <span className="font-mono-tabular text-lg font-bold mt-1 block">
                        {stat.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">{lang === 'en' ? 'Average pace' : 'Allure moyenne'}</span>
                    <span className="font-mono-tabular text-sm font-bold">{session.stats.paceMinPerKm} /km</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-tf-accent transition-all"
                      style={{ width: `${paceGaugePercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-500 dark:text-slate-400">{t.bestPaceLabel}</span>
                    <span className="font-mono-tabular font-bold">{session.stats.bestPaceMinPerKm ?? '--'} /km</span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium inline-flex items-center gap-1.5">
                      <Mountain className="w-3.5 h-3.5 text-tf-accent" />
                      {t.elevationProfile}
                    </span>
                    <span className="text-xs font-mono-tabular text-slate-500 dark:text-slate-400">
                      {Math.round(currentFlyover.altitude)} m
                    </span>
                  </div>
                  <div className="w-full h-36" role="img" aria-label={t.elevationProfile}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={elevationData} margin={{ top: 8, right: 10, left: -22, bottom: 2 }}>
                        <defs>
                          <linearGradient id="trackElevationFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={accentColor} stopOpacity={0.34} />
                            <stop offset="100%" stopColor={accentColor} stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#CBD5E1'} />
                        <XAxis
                          dataKey="distanceKm"
                          type="number"
                          domain={['dataMin', 'dataMax']}
                          tickFormatter={(value: number) => `${Number(value).toFixed(1)} km`}
                          tick={{ fontSize: 10, fill: isDark ? '#94A3B8' : '#64748B' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={['auto', 'auto']}
                          tickFormatter={(value: number) => `${Math.round(value)} m`}
                          tick={{ fontSize: 10, fill: isDark ? '#94A3B8' : '#64748B' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          labelFormatter={(value) => `${Number(value).toFixed(2)} km`}
                          formatter={(value) => [`${Math.round(Number(value))} m`, t.altitudeLabel]}
                          contentStyle={{
                            background: isDark ? '#0F172A' : '#FFFFFF',
                            border: `1px solid ${isDark ? '#334155' : '#CBD5E1'}`,
                            borderRadius: 12,
                            color: isDark ? '#F8FAFC' : '#0F172A',
                            fontSize: 12,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="altitude"
                          stroke={accentColor}
                          strokeWidth={2.5}
                          fill="url(#trackElevationFill)"
                          activeDot={{ r: 5, strokeWidth: 2 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                    {lang === 'en' ? 'Hover or tap the profile to see altitude.' : 'Survolez ou touchez le profil pour voir l’altitude.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadGpx}
                  className="w-full min-h-[48px] px-4 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-950 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>{gpxExportedToast ? t.gpxExported : t.exportGpxBtn}</span>
                </button>
              </div>
            )}

            {tab === 'export' && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-display text-base font-semibold">{t.saveAndShareHeading}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {activeTrack.title} · Fade In {config.fadeInSec}s · Fade Out {config.fadeOutSec}s
                  </p>
                </div>

                {/* Quick Phone Save & GPX Export Buttons */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={savingToPhone}
                    onClick={handleSaveRouteOnPhone}
                    className={`min-w-0 min-h-[54px] px-2 py-1.5 rounded-2xl border text-[11px] sm:text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors ${
                      savedToPhone
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-700 dark:text-emerald-200'
                        : 'bg-slate-100 dark:bg-slate-900/80 border-slate-200 dark:border-white/12 hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <BookmarkCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="truncate max-w-full">
                      {savedToPhone ? t.savedOnPhone : t.saveRoutePhone}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCreateMapSnapshot}
                    className="min-w-0 min-h-[54px] px-2 py-1.5 rounded-2xl bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-white/12 text-[11px] sm:text-xs font-semibold flex flex-col items-center justify-center gap-1 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                  >
                    <ImageIcon className="w-4 h-4 text-sky-500 shrink-0" />
                    <span className="truncate max-w-full">{t.savePngCard}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadGpx}
                    className={`min-w-0 min-h-[54px] px-2 py-1.5 rounded-2xl border text-[11px] sm:text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-colors ${
                      gpxExportedToast
                        ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-700 dark:text-emerald-200'
                        : 'bg-slate-100 dark:bg-slate-900/80 border-slate-200 dark:border-white/12 hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Download className="w-4 h-4 text-tf-accent shrink-0" />
                    <span className="truncate max-w-full">
                      {gpxExportedToast ? t.gpxExported : t.exportGpxBtn}
                    </span>
                  </button>
                </div>

                {snapshotUrl && (
                  <div className="p-3 rounded-2xl bg-sky-500/10 border border-sky-400/30 flex items-center justify-between gap-3">
                    <img
                      src={snapshotUrl}
                      alt="Map snapshot"
                      className="w-12 h-12 rounded-xl object-cover shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-sky-700 dark:text-sky-200">
                        PNG
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {t.savedOnPhone}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleNativeShare(true)}
                      className="min-h-[38px] px-3 rounded-xl bg-sky-500 text-white text-xs font-semibold shrink-0"
                    >
                      {t.share}
                    </button>
                  </div>
                )}

                {/* 3D Angle + Format Settings */}
                <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10 space-y-3.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium inline-flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-tf-accent" />
                      {t.cameraAngle3d}
                    </span>
                    <span className="font-mono-tabular text-slate-500 dark:text-slate-400">
                      {mapSettings.pitch}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={75}
                    step={1}
                    value={mapSettings.pitch}
                    onChange={(e) => updateSettings({ pitch: parseInt(e.target.value, 10) })}
                    className="tf-slider w-full"
                  />

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => updateSettings({ terrain3d: !mapSettings.terrain3d })}
                      className={`min-h-[42px] px-3 rounded-xl text-xs font-medium border flex items-center justify-center gap-1.5 ${
                        mapSettings.terrain3d
                          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-700 dark:text-emerald-200'
                          : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10'
                      }`}
                    >
                      <Mountain className="w-3.5 h-3.5" />
                      <span>{t.terrain3d}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setConfig((c) => ({ ...c, showStatsOverlay: !c.showStatsOverlay }));
                      }}
                      className={`min-h-[42px] px-3 rounded-xl text-xs font-medium border flex items-center justify-center gap-1.5 ${
                        config.showStatsOverlay
                          ? 'bg-tf-accent border-tf-accent text-white'
                          : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10'
                      }`}
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>{t.statsOnVideo}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setConfig((c) => ({ ...c, aspectRatio: '9:16' }));
                      }}
                      className={`min-h-[40px] rounded-xl text-xs font-semibold border ${
                        config.aspectRatio === '9:16'
                          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 border-slate-900 dark:border-white'
                          : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10'
                      }`}
                    >
                      9:16 Reels / TikTok
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        setConfig((c) => ({ ...c, aspectRatio: '16:9' }));
                      }}
                      className={`min-h-[40px] rounded-xl text-xs font-semibold border ${
                        config.aspectRatio === '16:9'
                          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-950 border-slate-900 dark:border-white'
                          : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10'
                      }`}
                    >
                      16:9 HD
                    </button>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    {[15, 25, 40, 60].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          setConfig((c) => ({ ...c, videoDurationSec: sec }));
                        }}
                        className={`flex-1 min-h-[38px] rounded-xl text-xs font-mono-tabular font-semibold border ${
                          config.videoDurationSec === sec
                            ? 'bg-tf-accent border-tf-accent text-white'
                            : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* Video Render Button */}
                {exportState ? (
                  <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-tf-accent space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        {exportState.phase === 'audio'
                          ? 'Audio...'
                          : exportState.phase === 'recording'
                            ? '3D Video + Stats Outro...'
                            : '...'}
                      </span>
                      <span className="font-mono-tabular text-tf-accent">
                        {Math.round(exportState.progress * 100)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-300 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-tf-accent transition-all duration-150"
                        style={{ width: `${Math.round(exportState.progress * 100)}%` }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => exportAbortRef.current?.abort()}
                      className="w-full min-h-[40px] rounded-xl bg-slate-200 dark:bg-white/8 text-xs font-medium"
                    >
                      {lang === 'en' ? 'Cancel' : 'Annuler'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartExport}
                    className="w-full min-h-[50px] rounded-2xl bg-tf-accent text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg transition-colors"
                  >
                    <Film className="w-4 h-4" />
                    <span>
                      {t.generateVideo3d} ({config.videoDurationSec}s)
                    </span>
                  </button>
                )}

                {exportError && (
                  <p className="text-xs text-red-500 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    {exportError}
                  </p>
                )}

                {exportedVideo && (
                  <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-400/30 space-y-3">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {t.videoReady}
                    </p>
                    <video
                      src={exportedVideo.url}
                      controls
                      playsInline
                      className="w-full max-h-56 rounded-xl bg-black"
                    />
                    <div className="grid grid-cols-2 gap-2.5">
                      <a
                        href={exportedVideo.url}
                        download={`${config.routeTitle.toLowerCase().replace(/\s+/g, '-')}.${exportedVideo.extension}`}
                        onClick={() => haptics.success()}
                        className="min-h-[44px] rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-4 h-4" />
                        <span>{t.saveToPhone}</span>
                      </a>
                      <button
                        type="button"
                        onClick={() => handleNativeShare(false)}
                        className="min-h-[44px] rounded-xl bg-tf-accent text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                      >
                        <Share2 className="w-4 h-4" />
                        <span>{t.share}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Social Sharing Bar */}
                <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-white/10 space-y-3">
                  <span className="text-xs font-medium block">{t.quickShare}</span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleNativeShare(false)}
                      className="min-h-[42px] px-3 rounded-xl bg-white dark:bg-white/8 text-xs font-medium flex items-center justify-center gap-1.5"
                    >
                      <Share2 className="w-3.5 h-3.5 text-tf-accent" />
                      <span>Instagram / TikTok</span>
                    </button>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(shareSummaryText)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => haptics.tap()}
                      className="min-h-[42px] px-3 rounded-xl bg-white dark:bg-white/8 text-xs font-medium flex items-center justify-center gap-1.5"
                    >
                      <span>WhatsApp</span>
                    </a>
                    <a
                      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareSummaryText)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => haptics.tap()}
                      className="min-h-[42px] px-3 rounded-xl bg-white dark:bg-white/8 text-xs font-medium flex items-center justify-center gap-1.5"
                    >
                      <span>X / Twitter</span>
                    </a>
                    <a
                      href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => haptics.tap()}
                      className="min-h-[42px] px-3 rounded-xl bg-white dark:bg-white/8 text-xs font-medium flex items-center justify-center gap-1.5"
                    >
                      <span>Facebook</span>
                    </a>
                    <button
                      type="button"
                      onClick={handleCopySummary}
                      className="min-h-[42px] px-3 rounded-xl bg-white dark:bg-white/8 text-xs font-medium flex items-center justify-center gap-1.5"
                    >
                      {copiedSummary ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedSummary ? t.copied : t.copy}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadGpx}
                      className="min-h-[42px] px-3 rounded-xl bg-white dark:bg-white/8 text-xs font-medium flex items-center justify-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{t.gpxFile}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedWaypoint && (
        <WaypointViewerModal
          waypoint={selectedWaypoint}
          lang={lang}
          onClose={() => setSelectedWaypoint(null)}
        />
      )}
    </div>
  );
};
