/**
 * Tactile haptic feedback helper using Web Vibration API with graceful desktop fallback.
 */

let hapticsEnabled = true;

export function setHapticsEnabled(enabled: boolean) {
  hapticsEnabled = enabled;
}

export function isHapticsEnabled(): boolean {
  return hapticsEnabled;
}

function vibrate(pattern: number | number[]) {
  if (!hapticsEnabled) return;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore if blocked by browser policy prior to gesture
    }
  }
}

export const haptics = {
  tap: () => vibrate(12),
  recordStart: () => vibrate([35, 45, 55]),
  pause: () => vibrate([24, 32, 24]),
  stop: () => vibrate([60, 40, 80]),
  capture: () => vibrate([18, 28, 36]),
  success: () => vibrate([24, 40, 24, 40, 58]),
  warning: () => vibrate([40, 30, 40]),
};
