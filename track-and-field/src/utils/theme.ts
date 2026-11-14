export type ThemeMode = 'auto' | 'dark' | 'light';

export type AccentColorId = 'orange' | 'emerald' | 'sky' | 'amber' | 'rose' | 'violet';

export interface AccentPreset {
  id: AccentColorId;
  labelFr: string;
  labelEn: string;
  hex: string;
  hoverHex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'orange', labelFr: 'Orange Trail', labelEn: 'Trail Orange', hex: '#FF5A1F', hoverHex: '#FF703D' },
  { id: 'emerald', labelFr: 'Vert Alpin', labelEn: 'Alpine Green', hex: '#10B981', hoverHex: '#34D399' },
  { id: 'sky', labelFr: 'Bleu Glacier', labelEn: 'Glacier Blue', hex: '#0EA5E9', hoverHex: '#38BDF8' },
  { id: 'amber', labelFr: 'Or Soleil', labelEn: 'Sun Gold', hex: '#F59E0B', hoverHex: '#FBBF24' },
  { id: 'rose', labelFr: 'Rouge Sommet', labelEn: 'Summit Red', hex: '#EF4444', hoverHex: '#F87171' },
  { id: 'violet', labelFr: 'Violet Crépuscule', labelEn: 'Dusk Violet', hex: '#8B5CF6', hoverHex: '#A78BFA' },
];

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  // Automatic Night Mode: evening/night hours (19:00 - 06:59) OR OS dark preference
  const hour = new Date().getHours();
  const isNightHour = hour >= 19 || hour < 7;
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return isNightHour || prefersDark;
}

export function applyThemeToDom(mode: ThemeMode, accentId: AccentColorId): boolean {
  const isDark = resolveIsDark(mode);
  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  const preset = ACCENT_PRESETS.find((p) => p.id === accentId) ?? ACCENT_PRESETS[0];
  root.style.setProperty('--tf-accent', preset.hex);
  root.style.setProperty('--tf-accent-hover', preset.hoverHex);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#090D12' : '#F8FAFC');
  }

  return isDark;
}

export function getAccentHex(accentId: AccentColorId): string {
  return (ACCENT_PRESETS.find((p) => p.id === accentId) ?? ACCENT_PRESETS[0]).hex;
}
