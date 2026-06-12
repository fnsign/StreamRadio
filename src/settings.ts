import {
  DEFAULT_POMODORO_LONG_BREAK_COLOR,
  DEFAULT_POMODORO_SHORT_BREAK_COLOR,
  LEGACY_DEFAULT_POMODORO_FOCUS_COLOR,
} from './constants';
import type { FavoriteStation, StreamRadioSettings } from './types';

export const DEFAULT_SETTINGS: StreamRadioSettings = {
  showStationLogos: true,
  favorites: [],
  activeStationId: '',
  volume: 1,
  muted: false,
  lastVolume: 1,
  pomodoroEnabled: true,
  pomodoroReducedDistractionEnabled: true,
  pomodoroDimFactor: 10,
  pomodoroFocusMinutes: 25,
  pomodoroTimerColor: '',
  pomodoroIntervals: 4,
  pomodoroShortBreakMinutes: 5,
  pomodoroShortBreakColor: DEFAULT_POMODORO_SHORT_BREAK_COLOR,
  pomodoroLongBreakMinutes: 20,
  pomodoroLongBreakColor: DEFAULT_POMODORO_LONG_BREAK_COLOR,
  pomodoroLongBreakEvery: 4,
  pomodoroHidden: false,
  pomodoroManualDimEnabled: false,
};

export function normalizeSettings(loadedSettings: Partial<StreamRadioSettings> | null, themeAccentColor: string): StreamRadioSettings {
  const settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings);
  settings.favorites = Array.isArray(settings.favorites)
    ? settings.favorites.filter((station) => station.stationuuid && station.streamUrl).map(normalizeFavoriteStation)
    : [];
  settings.volume = clampVolume(settings.volume ?? DEFAULT_SETTINGS.volume);
  settings.muted = settings.muted ?? DEFAULT_SETTINGS.muted;
  settings.lastVolume = clampVolume(settings.lastVolume ?? settings.volume ?? DEFAULT_SETTINGS.lastVolume);
  if (settings.lastVolume <= 0) {
    settings.lastVolume = DEFAULT_SETTINGS.lastVolume;
  }
  settings.pomodoroEnabled = settings.pomodoroEnabled ?? DEFAULT_SETTINGS.pomodoroEnabled;
  settings.pomodoroReducedDistractionEnabled = settings.pomodoroReducedDistractionEnabled ?? DEFAULT_SETTINGS.pomodoroReducedDistractionEnabled;
  settings.pomodoroDimFactor = clampPercentage(settings.pomodoroDimFactor, DEFAULT_SETTINGS.pomodoroDimFactor);
  settings.pomodoroFocusMinutes = clampInteger(settings.pomodoroFocusMinutes, DEFAULT_SETTINGS.pomodoroFocusMinutes, 1, 240);
  settings.pomodoroTimerColor = !loadedSettings?.pomodoroTimerColor || loadedSettings.pomodoroTimerColor === LEGACY_DEFAULT_POMODORO_FOCUS_COLOR
    ? themeAccentColor
    : sanitizeColor(settings.pomodoroTimerColor, themeAccentColor);
  settings.pomodoroIntervals = clampInteger(settings.pomodoroIntervals, DEFAULT_SETTINGS.pomodoroIntervals, 1, 8);
  settings.pomodoroShortBreakMinutes = clampInteger(settings.pomodoroShortBreakMinutes, DEFAULT_SETTINGS.pomodoroShortBreakMinutes, 1, 120);
  settings.pomodoroShortBreakColor = sanitizeColor(settings.pomodoroShortBreakColor, DEFAULT_SETTINGS.pomodoroShortBreakColor);
  settings.pomodoroLongBreakMinutes = clampInteger(settings.pomodoroLongBreakMinutes, DEFAULT_SETTINGS.pomodoroLongBreakMinutes, 1, 240);
  settings.pomodoroLongBreakColor = sanitizeColor(settings.pomodoroLongBreakColor, DEFAULT_SETTINGS.pomodoroLongBreakColor);
  settings.pomodoroLongBreakEvery = clampInteger(settings.pomodoroLongBreakEvery, DEFAULT_SETTINGS.pomodoroLongBreakEvery, 1, 8);
  settings.pomodoroHidden = settings.pomodoroHidden ?? DEFAULT_SETTINGS.pomodoroHidden;
  settings.pomodoroManualDimEnabled = settings.pomodoroManualDimEnabled ?? DEFAULT_SETTINGS.pomodoroManualDimEnabled;
  return settings;
}

function normalizeFavoriteStation(station: FavoriteStation): FavoriteStation {
  return {
    ...station,
    homepage: station.homepage || '',
  };
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_SETTINGS.volume;
  }

  return Math.min(1, Math.max(0, volume));
}

export function clampInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function clampPercentage(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(5, Math.round(value)));
}

export function sanitizeColor(value: string, fallback: string): string {
  if (!value) {
    return fallback;
  }

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}
