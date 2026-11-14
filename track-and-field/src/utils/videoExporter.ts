import type * as maplibregl from 'maplibre-gl';
import { musicEngine } from '../audio/musicEngine';
import type { Lang } from '../i18n/translations';
import { TRANSLATIONS } from '../i18n/translations';
import type { RecordedSession, VideoConfig, Waypoint } from '../types/track';
import { formatDuration, interpolateRouteAt } from './geo';

export interface ExportProgress {
  progress: number; // 0..1
  phase: 'audio' | 'recording' | 'finalizing';
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImageElement(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function exportFlyoverVideo(opts: {
  session: RecordedSession;
  config: VideoConfig;
  map: maplibregl.Map;
  mapCanvas: HTMLCanvasElement;
  pitch: number;
  accentColor?: string;
  lang?: Lang;
  onSyncProgress: (
    progress: number,
    coords: [number, number][],
    bearing: number,
    center: [number, number]
  ) => void;
  onProgress: (p: ExportProgress) => void;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; mimeType: string; extension: string }> {
  const {
    session,
    config,
    mapCanvas,
    pitch,
    accentColor = '#FF5A1F',
    lang = 'fr',
    map,
    onSyncProgress,
    onProgress,
    signal,
  } = opts;
  const t = TRANSLATIONS[lang];

  onProgress({ progress: 0.02, phase: 'audio' });

  // 1. Pre-render seamless loop music buffer
  const musicBuffer = await musicEngine.renderSeamlessLoop(config.trackId);
  const audioCtx = musicEngine.getAudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  // Preload photo images for waypoints
  const photoCache = new Map<string, HTMLImageElement>();
  for (const wp of session.waypoints) {
    if (wp.type === 'photo') {
      const img = await loadImageElement(wp.mediaUrl);
      if (img) photoCache.set(wp.id, img);
    }
  }

  // 2. Setup output compositor canvas
  const width = config.aspectRatio === '9:16' ? 720 : 1280;
  const height = config.aspectRatio === '9:16' ? 1280 : 720;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const ctx = outCanvas.getContext('2d');
  if (!ctx) throw new Error('Cannot create video canvas.');

  // 3. Exact Choreography Timings:
  // - Priority Audio Fade In starts at t=0
  // - Video Fade In starts slightly after Audio begins rising
  // - Flyover runs [0 .. flyoverSec]
  // - Video fades out over [flyoverSec - fadeOutSec .. flyoverSec] revealing the Final Stats Outro
  // - Final Stats stay visible on screen [flyoverSec .. totalSec] while music fades out AFTER video
  const totalSec = config.videoDurationSec;
  const fadeIn = Math.min(config.fadeInSec, totalSec * 0.35);
  const fadeOut = Math.min(config.fadeOutSec, totalSec * 0.3);
  const outroSec = Math.max(3.5, Math.min(totalSec * 0.34, fadeOut + 2.0));
  const flyoverSec = Math.max(4, totalSec - outroSec);
  const videoFadeInDelay = fadeIn > 0.2 ? Math.min(0.65, fadeIn * 0.4) : 0;

  const musicGain = audioCtx.createGain();
  const dest = audioCtx.createMediaStreamDestination();
  const musicSrc = audioCtx.createBufferSource();
  musicSrc.buffer = musicBuffer;
  musicSrc.loop = true;

  const targetVol = Math.max(0.05, config.musicVolume);
  const startAudioTime = audioCtx.currentTime + 0.05;

  // Priority Audio Fade In at start
  musicGain.gain.setValueAtTime(fadeIn > 0.05 ? 0.0001 : targetVol, startAudioTime);
  if (fadeIn > 0.05) {
    musicGain.gain.linearRampToValueAtTime(targetVol, startAudioTime + fadeIn);
  }
  // Music fades out AFTER the video has faded into the Final Stats Outro
  const musicFadeOutStart = Math.max(startAudioTime + fadeIn, startAudioTime + flyoverSec);
  musicGain.gain.setValueAtTime(targetVol, musicFadeOutStart);
  musicGain.gain.linearRampToValueAtTime(0.0001, startAudioTime + totalSec);

  musicSrc.connect(musicGain);
  musicGain.connect(dest);

  // 4. Combine video + audio streams into MediaRecorder
  const videoStream = outCanvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeCandidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  const chosenMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const recorder = chosenMime
    ? new MediaRecorder(combinedStream, { mimeType: chosenMime, videoBitsPerSecond: 4_200_000 })
    : new MediaRecorder(combinedStream);

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopPromise = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    };
  });

  // Trigger audio + recording
  musicSrc.start(startAudioTime);
  recorder.start(200);

  const startMs = performance.now();
  const totalMs = totalSec * 1000;

  return new Promise((resolve, reject) => {
    const renderFrame = (now: number) => {
      if (signal?.aborted) {
        try {
          recorder.stop();
          musicSrc.stop();
        } catch {
          // ignore
        }
        reject(new Error(lang === 'en' ? 'Export cancelled' : 'Export annulé'));
        return;
      }

      const elapsedMs = now - startMs;
      const elapsedSec = elapsedMs / 1000;
      const overallP = Math.min(1, elapsedMs / totalMs);
      const routeP = Math.min(1, elapsedSec / flyoverSec);

      // Update MapLibre camera synchronously for crisp frame capture
      const state = interpolateRouteAt(session.points, routeP);
      map.jumpTo({
        center: [state.lng, state.lat],
        bearing: state.bearing * 0.35,
        pitch,
        zoom: 15.8,
      });
      onSyncProgress(routeP, state.partialCoords, state.bearing * 0.35, [state.lng, state.lat]);

      // Base dark backdrop
      ctx.fillStyle = '#090D12';
      ctx.fillRect(0, 0, width, height);

      // Compute map opacity: fades in after audio starts, fades out before Final Stats Outro
      let mapAlpha = 1;
      if (fadeIn > 0.05) {
        const videoInElapsed = elapsedSec - videoFadeInDelay;
        if (videoInElapsed <= 0) {
          mapAlpha = 0;
        } else if (videoInElapsed < fadeIn) {
          mapAlpha = Math.min(mapAlpha, videoInElapsed / fadeIn);
        }
      }
      if (elapsedSec >= flyoverSec) {
        mapAlpha = 0;
      } else if (fadeOut > 0.05 && elapsedSec > flyoverSec - fadeOut) {
        mapAlpha = Math.min(mapAlpha, Math.max(0, (flyoverSec - elapsedSec) / fadeOut));
      }

      if (mapAlpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = mapAlpha;

        const srcW = mapCanvas.width || 1;
        const srcH = mapCanvas.height || 1;
        const scale = Math.max(width / srcW, height / srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        const dx = (width - drawW) / 2;
        const dy = (height - drawH) / 2;

        try {
          ctx.drawImage(mapCanvas, dx, dy, drawW, drawH);
        } catch {
          // Fallback dark background if tainted
        }

        // Subtle cinematic top/bottom vignette scrims
        const topGrad = ctx.createLinearGradient(0, 0, 0, 220);
        topGrad.addColorStop(0, 'rgba(9,13,18,0.85)');
        topGrad.addColorStop(1, 'rgba(9,13,18,0)');
        ctx.fillStyle = topGrad;
        ctx.fillRect(0, 0, width, 220);

        const botGrad = ctx.createLinearGradient(0, height - 260, 0, height);
        botGrad.addColorStop(0, 'rgba(9,13,18,0)');
        botGrad.addColorStop(1, 'rgba(9,13,18,0.92)');
        ctx.fillStyle = botGrad;
        ctx.fillRect(0, height - 260, width, 260);

        // Top Header Title
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 32px Outfit, sans-serif';
        ctx.fillText(config.routeTitle || session.title, 36, 68);
        ctx.fillStyle = '#CBD5E1';
        ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
        ctx.fillText('Track & Field', 36, 98);

        // Check active waypoint spotlight (within ±0.055 route progress)
        const activeWp: Waypoint | undefined = session.waypoints.find(
          (w) => Math.abs(w.progress - routeP) < 0.055
        );

        if (activeWp) {
          const cardW = Math.min(width - 72, 420);
          const cardH = activeWp.type === 'photo' ? 280 : 120;
          const cardX = (width - cardW) / 2;
          const cardY = height - 340 - cardH;

          ctx.save();
          drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 20);
          ctx.fillStyle = 'rgba(15, 21, 29, 0.92)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
          ctx.stroke();

          if (activeWp.type === 'photo') {
            const img = photoCache.get(activeWp.id);
            if (img) {
              ctx.save();
              drawRoundedRect(ctx, cardX + 12, cardY + 12, cardW - 24, 196, 14);
              ctx.clip();
              const is = Math.max((cardW - 24) / img.width, 196 / img.height);
              const iw = img.width * is;
              const ih = img.height * is;
              ctx.drawImage(
                img,
                cardX + 12 + (cardW - 24 - iw) / 2,
                cardY + 12 + (196 - ih) / 2,
                iw,
                ih
              );
              ctx.restore();
            }
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '600 20px Outfit, sans-serif';
            ctx.fillText(activeWp.title, cardX + 20, cardY + 242);
            ctx.fillStyle = '#94A3B8';
            ctx.font = '500 15px "JetBrains Mono", monospace';
            ctx.fillText(
              `${activeWp.distanceKm.toFixed(2)} km · ${Math.round(activeWp.altitude)} m`,
              cardX + 20,
              cardY + 266
            );
          } else {
            ctx.fillStyle = activeWp.type === 'voice' ? '#10B981' : '#0EA5E9';
            ctx.beginPath();
            ctx.arc(cardX + 46, cardY + 60, 22, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.font = '600 20px Outfit, sans-serif';
            ctx.fillText(activeWp.title, cardX + 84, cardY + 54);
            ctx.fillStyle = '#94A3B8';
            ctx.font = '500 15px "JetBrains Mono", monospace';
            ctx.fillText(
              `${activeWp.type === 'voice' ? t.voiceNote : t.video} · ${activeWp.distanceKm.toFixed(2)} km`,
              cardX + 84,
              cardY + 80
            );
          }
          ctx.restore();
        }

        // Bottom Live Stats HUD
        if (config.showStatsOverlay) {
          const currentTimeSec = Math.round(routeP * session.stats.durationSec);
          const yBase = height - 108;

          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          drawRoundedRect(ctx, 36, yBase - 38, width - 72, 6, 3);
          ctx.fill();
          ctx.fillStyle = accentColor;
          drawRoundedRect(ctx, 36, yBase - 38, Math.max(8, (width - 72) * routeP), 6, 3);
          ctx.fill();

          const cols = [
            { label: t.distanceLabel.toUpperCase(), val: `${state.distanceKm.toFixed(2)} km` },
            { label: t.durationLabel.toUpperCase(), val: formatDuration(currentTimeSec) },
            { label: t.elevationLabel.toUpperCase(), val: `${session.stats.elevationGainM} m` },
            { label: t.altitudeLabel.toUpperCase(), val: `${Math.round(state.altitude)} m` },
          ];
          const colW = (width - 72) / cols.length;
          cols.forEach((c, idx) => {
            const x = 36 + idx * colW;
            ctx.fillStyle = '#94A3B8';
            ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
            ctx.fillText(c.label, x, yBase);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '700 26px "JetBrains Mono", monospace';
            ctx.fillText(c.val, x, yBase + 34);
          });
        }

        ctx.restore();
      }

      // Final Stats Outro Card: fades in as the map video fades out, and STAYS visible
      // cleanly on screen while music fades out at the end!
      let outroAlpha = 0;
      if (elapsedSec >= flyoverSec) {
        outroAlpha = 1;
      } else if (fadeOut > 0.05 && elapsedSec > flyoverSec - fadeOut) {
        outroAlpha = (elapsedSec - (flyoverSec - fadeOut)) / fadeOut;
      }

      if (outroAlpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, outroAlpha);

        const padX = width > 900 ? 160 : 48;
        const cardW = width - padX * 2;
        const cardH = width > 900 ? 440 : 620;
        const cardX = padX;
        const cardY = (height - cardH) / 2;

        drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
        ctx.fillStyle = 'rgba(15, 21, 29, 0.96)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = accentColor;
        ctx.stroke();

        // Top Accent Bar
        ctx.fillStyle = accentColor;
        ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(`TRACK & FIELD · ${t.finalStatsTitle.toUpperCase()}`, cardX + 36, cardY + 54);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '700 34px Outfit, sans-serif';
        ctx.fillText(config.routeTitle || session.title, cardX + 36, cardY + 102);

        const finalGrid = [
          { label: t.distanceLabel, value: `${session.stats.distanceKm.toFixed(2)} km` },
          { label: t.durationLabel, value: formatDuration(session.stats.durationSec) },
          { label: t.elevationLabel, value: `+${session.stats.elevationGainM} m` },
          { label: t.avgSpeedLabel, value: `${session.stats.avgSpeedKmh.toFixed(1)} km/h` },
          { label: t.paceLabel, value: `${session.stats.paceMinPerKm} /km` },
          { label: t.waypointsLabel, value: `${session.waypoints.length}` },
        ];

        const colsCount = width > 900 ? 3 : 2;
        const cellW = (cardW - 72) / colsCount;
        const cellH = width > 900 ? 120 : 132;
        const gridStartY = cardY + 148;

        finalGrid.forEach((item, idx) => {
          const col = idx % colsCount;
          const row = Math.floor(idx / colsCount);
          const bx = cardX + 36 + col * cellW;
          const by = gridStartY + row * cellH;

          drawRoundedRect(ctx, bx, by, cellW - 14, cellH - 14, 16);
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fill();

          ctx.fillStyle = '#94A3B8';
          ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
          ctx.fillText(item.label, bx + 18, by + 36);

          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 28px "JetBrains Mono", monospace';
          ctx.fillText(item.value, bx + 18, by + 80);
        });

        ctx.restore();
      }

      onProgress({ progress: 0.08 + overallP * 0.87, phase: 'recording' });

      if (elapsedMs < totalMs) {
        requestAnimationFrame(renderFrame);
      } else {
        onProgress({ progress: 0.97, phase: 'finalizing' });
        try {
          musicSrc.stop();
        } catch {
          // ignore
        }
        recorder.stop();
        stopPromise
          .then((blob) => {
            const finalMime = blob.type || chosenMime || 'video/webm';
            const extension = finalMime.includes('mp4') ? 'mp4' : 'webm';
            onProgress({ progress: 1, phase: 'finalizing' });
            resolve({ blob, mimeType: finalMime, extension });
          })
          .catch(reject);
      }
    };

    requestAnimationFrame(renderFrame);
  });
}
