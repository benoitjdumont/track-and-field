import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Mic, RotateCcw, Square, Upload, Video, X } from 'lucide-react';
import type { Lang } from '../i18n/translations';
import type { WaypointType } from '../types/track';
import { formatDuration } from '../utils/geo';
import { haptics } from '../utils/haptics';

interface MediaCaptureModalProps {
  mode: WaypointType;
  lang?: Lang;
  onClose: () => void;
  onSave: (payload: {
    type: WaypointType;
    title: string;
    mediaUrl: string;
    durationSec?: number;
    mimeType?: string;
  }) => void;
}

export const MediaCaptureModal: React.FC<MediaCaptureModalProps> = ({
  mode,
  lang = 'fr',
  onClose,
  onSave,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedMime, setCapturedMime] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState(
    lang === 'en'
      ? mode === 'photo'
        ? 'Photo spot'
        : mode === 'video'
          ? 'Video clip'
          : 'Voice note'
      : mode === 'photo'
        ? 'Point photo'
        : mode === 'video'
          ? 'Séquence vidéo'
          : 'Note vocale'
  );
  const [waveBars, setWaveBars] = useState<number[]>(Array(18).fill(0.15));

  const stopStreams = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    if (capturedUrl) return;
    let cancelled = false;

    async function initMedia() {
      setCameraError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            lang === 'en'
              ? 'Camera or microphone unavailable in this browser.'
              : 'Caméra ou micro indisponible dans ce navigateur.'
          );
        }

        const constraints: MediaStreamConstraints =
          mode === 'voice'
            ? { audio: true }
            : {
                video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: mode === 'video',
              };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        if (mode !== 'voice' && videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        if (mode === 'voice') {
          const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ac = new AC();
          audioCtxRef.current = ac;
          const src = ac.createMediaStreamSource(stream);
          const analyser = ac.createAnalyser();
          analyser.fftSize = 64;
          src.connect(analyser);
          analyserRef.current = analyser;
        }
      } catch (err) {
        if (!cancelled) {
          setCameraError(
            err instanceof Error
              ? err.message
              : lang === 'en'
                ? 'Allow camera/mic access or import a file from your device.'
                : 'Autorisez l’accès caméra/micro ou importez un fichier depuis votre appareil.'
          );
        }
      }
    }

    void initMedia();
    return () => {
      cancelled = true;
      stopStreams();
    };
  }, [mode, facingMode, capturedUrl, lang]);

  const startWaveLoop = () => {
    const tick = () => {
      if (analyserRef.current) {
        const arr = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(arr);
        const next = Array.from({ length: 18 }, (_, i) => {
          const v = arr[Math.min(arr.length - 1, i + 1)] / 255;
          return Math.max(0.14, Math.min(1, v * 1.4));
        });
        setWaveBars(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const snapPhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    haptics.capture();
    stopStreams();
    setCapturedMime('image/jpeg');
    setCapturedUrl(dataUrl);
  };

  const startRecording = () => {
    if (!streamRef.current) return;
    haptics.recordStart();
    chunksRef.current = [];
    const preferredTypes =
      mode === 'voice'
        ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        : ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
    const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = mimeType
      ? new MediaRecorder(streamRef.current, { mimeType })
      : new MediaRecorder(streamRef.current);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const finalMime = recorder.mimeType || (mode === 'voice' ? 'audio/webm' : 'video/webm');
      const blob = new Blob(chunksRef.current, { type: finalMime });
      const url = URL.createObjectURL(blob);
      stopStreams();
      setCapturedMime(finalMime);
      setCapturedUrl(url);
      setIsRecording(false);
    };

    recorderRef.current = recorder;
    recorder.start(250);
    setIsRecording(true);
    setElapsedSec(0);
    if (mode === 'voice') startWaveLoop();

    timerRef.current = window.setInterval(() => {
      setElapsedSec((prev) => {
        if (mode === 'video' && prev >= 14) {
          stopRecording();
          return 15;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      haptics.stop();
      recorderRef.current.stop();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    haptics.capture();
    const url = URL.createObjectURL(file);
    stopStreams();
    setCapturedMime(file.type);
    setCapturedUrl(url);
  };

  const handleRetake = () => {
    haptics.tap();
    setCapturedUrl(null);
    setElapsedSec(0);
  };

  const handleConfirm = () => {
    if (!capturedUrl) return;
    haptics.success();
    onSave({
      type: mode,
      title: title.trim() || (lang === 'en' ? 'Waypoint' : 'Point de repère'),
      mediaUrl: capturedUrl,
      durationSec: mode === 'photo' ? undefined : Math.max(1, elapsedSec),
      mimeType: capturedMime,
    });
  };

  const labelMap =
    lang === 'en'
      ? {
          photo: 'Take a photo',
          video: 'Record a clip (15s max)',
          voice: 'Record a voice note',
        }
      : {
          photo: 'Capturer une photo',
          video: 'Filmer un clip (15s max)',
          voice: 'Enregistrer une note vocale',
        };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#0F151D] text-slate-900 dark:text-white border border-slate-200 dark:border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2.5">
            {mode === 'photo' && <Camera className="w-5 h-5 text-tf-accent" />}
            {mode === 'video' && <Video className="w-5 h-5 text-sky-500" />}
            {mode === 'voice' && <Mic className="w-5 h-5 text-emerald-500" />}
            <h2 className="font-display text-base font-semibold">{labelMap[mode]}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'en' ? 'Close' : 'Fermer'}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preview Stage */}
        <div className="relative bg-black flex-1 min-h-[260px] flex flex-col items-center justify-center overflow-hidden">
          {capturedUrl ? (
            mode === 'photo' ? (
              <img src={capturedUrl} alt={title} className="w-full h-72 object-cover" />
            ) : mode === 'video' ? (
              <video src={capturedUrl} controls playsInline className="w-full h-72 object-cover" />
            ) : (
              <div className="w-full p-6 flex flex-col items-center gap-4 bg-gradient-to-b from-slate-900 to-[#090D12]">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
                  <Mic className="w-7 h-7 text-emerald-400" />
                </div>
                <p className="text-sm text-slate-300 font-mono-tabular">
                  {lang === 'en' ? 'Voice note' : 'Note vocale'} · {formatDuration(elapsedSec)}
                </p>
                <audio src={capturedUrl} controls className="w-full" />
              </div>
            )
          ) : cameraError ? (
            <div className="p-6 text-center flex flex-col items-center gap-4">
              <p className="text-sm text-slate-300 max-w-xs">{cameraError}</p>
              <label className="min-h-[44px] px-5 py-2.5 rounded-xl bg-tf-accent text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors">
                <Upload className="w-4 h-4" />
                <span>
                  {lang === 'en'
                    ? mode === 'photo'
                      ? 'Choose / Take Photo'
                      : mode === 'video'
                        ? 'Choose / Record Video'
                        : 'Import Audio File'
                    : mode === 'photo'
                      ? 'Choisir / Prendre une photo'
                      : mode === 'video'
                        ? 'Choisir / Filmer une vidéo'
                        : 'Importer un fichier audio'}
                </span>
                <input
                  type="file"
                  accept={mode === 'photo' ? 'image/*' : mode === 'video' ? 'video/*' : 'audio/*'}
                  capture={mode === 'voice' ? undefined : 'environment'}
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          ) : mode === 'voice' ? (
            <div className="w-full py-12 px-6 flex flex-col items-center gap-6 bg-gradient-to-b from-slate-900 to-[#090D12]">
              <div className="flex items-end justify-center gap-1.5 h-20">
                {waveBars.map((val, i) => (
                  <div
                    key={i}
                    className="w-2 rounded-full bg-emerald-400 transition-all duration-75"
                    style={{ height: `${Math.round(val * 76)}px`, opacity: isRecording ? 1 : 0.35 }}
                  />
                ))}
              </div>
              <div className="font-mono-tabular text-2xl font-semibold text-white">
                {formatDuration(elapsedSec)}
              </div>
              <p className="text-xs text-slate-400">
                {isRecording
                  ? lang === 'en'
                    ? 'Recording audio...'
                    : 'Enregistrement audio en cours...'
                  : lang === 'en'
                    ? 'Tap below to record your voice note'
                    : 'Appuyez ci-dessous pour enregistrer votre mémo'}
              </p>
            </div>
          ) : (
            <>
              <video ref={videoRef} playsInline muted className="w-full h-72 object-cover" />
              {isRecording && (
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-red-600/90 text-white text-xs font-mono-tabular font-semibold">
                  REC {formatDuration(elapsedSec)} / 00:15
                </div>
              )}
              <button
                type="button"
                onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
                aria-label={lang === 'en' ? 'Switch camera' : 'Inverser la caméra'}
                className="absolute top-3 right-3 min-w-[44px] min-h-[44px] rounded-full bg-black/55 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/75 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Footer Controls */}
        <div className="p-5 pb-safe bg-white dark:bg-[#0F151D] border-t border-slate-200 dark:border-white/10 space-y-4">
          {capturedUrl ? (
            <>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                  {lang === 'en' ? 'Waypoint label on map' : 'Titre du point de repère sur la carte'}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={48}
                  className="w-full h-11 px-3.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/12 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-tf-accent"
                  placeholder={lang === 'en' ? 'e.g. Summit viewpoint' : 'Ex: Vue panoramique du sommet'}
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRetake}
                  className="flex-1 min-h-[48px] rounded-xl bg-slate-100 dark:bg-white/8 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-white/15 transition-colors"
                >
                  {lang === 'en' ? 'Retake' : 'Refaire'}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="flex-1 min-h-[48px] rounded-xl bg-tf-accent text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  <span>{lang === 'en' ? 'Pin to route' : 'Ajouter au parcours'}</span>
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <label className="min-h-[44px] px-3.5 rounded-xl bg-slate-100 dark:bg-white/8 text-slate-700 dark:text-slate-200 text-xs font-medium inline-flex items-center gap-2 cursor-pointer hover:bg-slate-200 dark:hover:bg-white/15 transition-colors whitespace-nowrap shrink-0">
                <Upload className="w-4 h-4" />
                <span>{lang === 'en' ? 'Import' : 'Importer'}</span>
                <input
                  type="file"
                  accept={mode === 'photo' ? 'image/*' : mode === 'video' ? 'video/*' : 'audio/*'}
                  capture={mode === 'voice' ? undefined : 'environment'}
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {mode === 'photo' ? (
                <button
                  type="button"
                  disabled={!!cameraError}
                  onClick={snapPhoto}
                  className="flex-1 min-h-[48px] rounded-xl bg-tf-accent disabled:opacity-40 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  <Camera className="w-4 h-4" />
                  <span>{lang === 'en' ? 'Take photo' : 'Prendre la photo'}</span>
                </button>
              ) : isRecording ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="flex-1 min-h-[48px] rounded-xl bg-red-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-red-500 transition-colors"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span>{lang === 'en' ? 'Finish' : 'Terminer'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!!cameraError}
                  onClick={startRecording}
                  className="flex-1 min-h-[48px] rounded-xl bg-tf-accent disabled:opacity-40 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                >
                  {mode === 'video' ? <Video className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  <span>{lang === 'en' ? 'Start capture' : 'Démarrer la capture'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
