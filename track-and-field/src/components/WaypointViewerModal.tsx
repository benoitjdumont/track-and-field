import React from 'react';
import { Camera, MapPin, Mic, Trash2, Video, X } from 'lucide-react';
import { TRANSLATIONS, type Lang } from '../i18n/translations';
import type { Waypoint } from '../types/track';
import { formatDuration } from '../utils/geo';

interface WaypointViewerModalProps {
  waypoint: Waypoint;
  lang?: Lang;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

export const WaypointViewerModal: React.FC<WaypointViewerModalProps> = ({
  waypoint,
  lang = 'fr',
  onClose,
  onDelete,
}) => {
  const t = TRANSLATIONS[lang];
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-[#0F151D] text-slate-900 dark:text-white border border-slate-200 dark:border-white/12 rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            {waypoint.type === 'photo' && <Camera className="w-4 h-4 text-tf-accent shrink-0" />}
            {waypoint.type === 'video' && <Video className="w-4 h-4 text-sky-500 shrink-0" />}
            {waypoint.type === 'voice' && <Mic className="w-4 h-4 text-emerald-500 shrink-0" />}
            <h3 className="font-display text-base font-semibold truncate">{waypoint.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-black">
          {waypoint.type === 'photo' && (
            <img
              src={waypoint.mediaUrl}
              alt={waypoint.title}
              className="w-full max-h-80 object-cover"
            />
          )}
          {waypoint.type === 'video' && (
            <video
              src={waypoint.mediaUrl}
              controls
              autoPlay
              playsInline
              className="w-full max-h-80 object-cover"
            />
          )}
          {waypoint.type === 'voice' && (
            <div className="p-6 flex flex-col items-center gap-4 bg-slate-950">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
                <Mic className="w-6 h-6 text-emerald-400" />
              </div>
              <audio src={waypoint.mediaUrl} controls autoPlay className="w-full" />
            </div>
          )}
        </div>

        <div className="px-5 py-4 pb-safe flex items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2 font-mono-tabular">
            <MapPin className="w-3.5 h-3.5 text-slate-400" />
            <span>{waypoint.distanceKm.toFixed(2)} km</span>
            <span aria-hidden="true">·</span>
            <span>{Math.round(waypoint.altitude)} m</span>
            {waypoint.durationSec ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatDuration(waypoint.durationSec)}</span>
              </>
            ) : null}
          </div>
          {onDelete && (
            <button
              type="button"
              onClick={() => {
                onDelete(waypoint.id);
                onClose();
              }}
              className="min-h-[40px] px-3 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1.5 font-medium transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>{t.deleteLabel}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
