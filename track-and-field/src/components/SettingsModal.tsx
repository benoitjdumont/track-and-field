import React, { useState } from 'react';
import {
  Building2,
  Check,
  Compass,
  Crosshair,
  FolderOpen,
  Globe,
  Layers,
  Moon,
  Mountain,
  Music,
  Pause,
  Play,
  Smartphone,
  Sun,
  SunMoon,
  X,
} from 'lucide-react';
import { MUSIC_TRACKS, musicEngine } from '../audio/musicEngine';
import { TRANSLATIONS, type Lang } from '../i18n/translations';
import type { MapSettings } from '../types/track';
import { haptics } from '../utils/haptics';
import { ACCENT_PRESETS, type AccentColorId, type ThemeMode } from '../utils/theme';

interface SettingsModalProps {
  onClose: () => void;
  lang: Lang;
  onChangeLang: (lang: Lang) => void;
  themeMode: ThemeMode;
  onChangeThemeMode: (mode: ThemeMode) => void;
  isDarkActive: boolean;
  accentColorId: AccentColorId;
  onChangeAccentColor: (id: AccentColorId) => void;
  mapSettings: MapSettings;
  onChangeMapSettings: (next: MapSettings) => void;
  defaultTrackId: string;
  onChangeDefaultTrackId: (id: string) => void;
  hapticsOn: boolean;
  onToggleHaptics: () => void;
  gpsStatus: 'searching' | 'locked' | 'unavailable';
  onRecenterGps?: () => void;
  onOpenSavedTracks?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  lang,
  onChangeLang,
  themeMode,
  onChangeThemeMode,
  isDarkActive,
  accentColorId,
  onChangeAccentColor,
  mapSettings,
  onChangeMapSettings,
  defaultTrackId,
  onChangeDefaultTrackId,
  hapticsOn,
  onToggleHaptics,
  gpsStatus,
  onRecenterGps,
  onOpenSavedTracks,
}) => {
  const t = TRANSLATIONS[lang];
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleClose = () => {
    haptics.tap();
    if (previewingId) {
      musicEngine.stop(0.15);
      setPreviewingId(null);
    }
    onClose();
  };

  const handlePreviewAndSelectTrack = async (trackId: string) => {
    haptics.tap();
    onChangeDefaultTrackId(trackId);
    if (previewingId === trackId) {
      musicEngine.stop(0.15);
      setPreviewingId(null);
      return;
    }
    setLoadingId(trackId);
    try {
      await musicEngine.playPreview(trackId, 0.72, 0.2);
      setPreviewingId(trackId);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-[#0F151D] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-white/12 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-2 shrink-0">
          <h2 className="font-display text-lg font-bold truncate">{t.settingsTitle}</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t.close}
            className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Settings Sections */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 pb-safe space-y-6">
          {/* 1. Language Toggle (FR / EN) */}
          <section className="space-y-2.5">
            <h3 className="font-display text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Globe className="w-4 h-4 text-tf-accent" />
              <span>{t.secLanguage}</span>
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'fr' as const, label: 'Français' },
                  { id: 'en' as const, label: 'English' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    onChangeLang(item.id);
                  }}
                  className={`min-h-[44px] rounded-2xl text-sm font-semibold border transition-colors ${
                    lang === item.id
                      ? 'bg-tf-accent border-tf-accent text-white'
                      : 'bg-slate-100 dark:bg-white/6 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          {/* 2. Appearance & Automatic Night Mode + 6 Accent Colors */}
          <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-white/10">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <SunMoon className="w-4 h-4 text-tf-accent" />
                <span>{t.secAppearance}</span>
              </h3>
              <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                {isDarkActive ? t.modeDark : t.modeLight}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'auto' as const, label: t.modeAuto, icon: SunMoon },
                  { id: 'dark' as const, label: t.modeDark, icon: Moon },
                  { id: 'light' as const, label: t.modeLight, icon: Sun },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = themeMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      haptics.tap();
                      onChangeThemeMode(item.id);
                    }}
                    className={`min-h-[48px] px-2 rounded-2xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                      active
                        ? 'bg-tf-accent border-tf-accent text-white'
                        : 'bg-slate-100 dark:bg-white/6 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-2 pt-1">
              <span className="text-xs text-slate-500 dark:text-slate-400 block">
                {t.accentColorLabel}
              </span>
              <div className="grid grid-cols-6 gap-2.5">
                {ACCENT_PRESETS.map((preset) => {
                  const selected = accentColorId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-label={lang === 'en' ? preset.labelEn : preset.labelFr}
                      title={lang === 'en' ? preset.labelEn : preset.labelFr}
                      onClick={() => {
                        haptics.tap();
                        onChangeAccentColor(preset.id);
                      }}
                      style={{ backgroundColor: preset.hex }}
                      className={`h-11 rounded-2xl flex items-center justify-center transition-transform ${
                        selected
                          ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-[#0F151D] scale-105'
                          : 'opacity-85 hover:opacity-100'
                      }`}
                    >
                      {selected && <Check className="w-5 h-5 text-white drop-shadow" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* 3. 3D Map & GPS Section (moved into Settings as requested) */}
          <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-white/10">
            <h3 className="font-display text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Layers className="w-4 h-4 text-tf-accent" />
              <span>{t.secMap3d}</span>
            </h3>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  onChangeMapSettings({ ...mapSettings, satellite: !mapSettings.satellite });
                }}
                className={`min-h-[58px] p-2 rounded-2xl border flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors ${
                  mapSettings.satellite
                    ? 'bg-tf-accent border-tf-accent text-white'
                    : 'bg-slate-100 dark:bg-white/6 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>{t.satellite}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  onChangeMapSettings({ ...mapSettings, buildings3d: !mapSettings.buildings3d });
                }}
                className={`min-h-[58px] p-2 rounded-2xl border flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors ${
                  mapSettings.buildings3d
                    ? 'bg-sky-500 border-sky-400 text-white'
                    : 'bg-slate-100 dark:bg-white/6 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>{t.buildings3d}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  onChangeMapSettings({ ...mapSettings, terrain3d: !mapSettings.terrain3d });
                }}
                className={`min-h-[58px] p-2 rounded-2xl border flex flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors ${
                  mapSettings.terrain3d
                    ? 'bg-emerald-500 border-emerald-400 text-white'
                    : 'bg-slate-100 dark:bg-white/6 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300'
                }`}
              >
                <Mountain className="w-4 h-4" />
                <span>{t.terrain3d}</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-300 font-medium inline-flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-tf-accent" />
                  {t.angle3d}
                </span>
                <span className="font-mono-tabular text-slate-600 dark:text-slate-300">
                  {mapSettings.pitch}°
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={75}
                step={1}
                value={mapSettings.pitch}
                onChange={(e) =>
                  onChangeMapSettings({ ...mapSettings, pitch: parseInt(e.target.value, 10) })
                }
                className="tf-slider w-full"
              />
            </div>

            <div className="space-y-2">
              {onRecenterGps && (
                <button
                  type="button"
                  onClick={() => {
                    onRecenterGps();
                    handleClose();
                  }}
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-100 dark:bg-white/8 hover:bg-slate-200 dark:hover:bg-white/14 text-xs font-medium flex items-center justify-between"
                >
                  <span className="inline-flex items-center gap-2">
                    <Crosshair className="w-4 h-4 text-sky-500" />
                    {t.recenterGps}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {gpsStatus === 'locked' ? 'GPS OK' : 'Auto'}
                  </span>
                </button>
              )}

              {onOpenSavedTracks && (
                <button
                  type="button"
                  onClick={() => {
                    handleClose();
                    onOpenSavedTracks();
                  }}
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-100 dark:bg-white/8 hover:bg-slate-200 dark:hover:bg-white/14 text-xs font-medium flex items-center gap-2"
                >
                  <FolderOpen className="w-4 h-4 text-sky-500" />
                  <span>{t.savedTracksTitle}</span>
                </button>
              )}

            </div>
          </section>

          {/* 4. Default Music Selection (10 Seamless Tracks with instant preview) */}
          <section className="space-y-2.5 pt-4 border-t border-slate-200 dark:border-white/10">
            <h3 className="font-display text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Music className="w-4 h-4 text-tf-accent" />
              <span>{t.secMusic}</span>
            </h3>
            <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
              {MUSIC_TRACKS.map((track, idx) => {
                const selected = defaultTrackId === track.id;
                const playing = previewingId === track.id;
                const loading = loadingId === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => handlePreviewAndSelectTrack(track.id)}
                    className={`w-full min-h-[54px] px-3 py-2 rounded-2xl border text-left flex items-center gap-3 transition-colors ${
                      selected
                        ? 'bg-slate-100 dark:bg-white/10 border-tf-accent'
                        : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/8 hover:bg-slate-100 dark:hover:bg-white/8'
                    }`}
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white"
                      style={{
                        backgroundColor: playing ? track.accentColor : '#334155',
                      }}
                    >
                      {loading ? (
                        <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      ) : playing ? (
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-xs font-semibold truncate">
                          {String(idx + 1).padStart(2, '0')}. {track.title}
                        </span>
                        <span className="font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                          {track.bpm} BPM
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {track.genre} · {track.mood}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2.5 pt-4 border-t border-slate-200 dark:border-white/10">
            <h3 className="font-display text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-tf-accent" />
              <span>{t.hapticsLabel}</span>
            </h3>
            <button
              type="button"
              onClick={onToggleHaptics}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-100 dark:bg-white/8 text-xs font-medium flex items-center justify-between"
            >
              <span>{t.hapticsLabel}</span>
              <span className="font-mono-tabular font-semibold">{hapticsOn ? 'ON' : 'OFF'}</span>
            </button>
          </section>

        </div>
      </div>
    </div>
  );
};
