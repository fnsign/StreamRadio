import type { App } from 'obsidian';

export type SettingsSection = 'radio' | 'pomodoro';
export type PomodoroPhase = 'focus' | 'short-break' | 'long-break';
export type NumberSettingKey = 'pomodoroFocusMinutes' | 'pomodoroIntervals' | 'pomodoroShortBreakMinutes' | 'pomodoroLongBreakMinutes' | 'pomodoroLongBreakEvery' | 'pomodoroDimFactor';
export type ColorSettingKey = 'pomodoroTimerColor' | 'pomodoroShortBreakColor' | 'pomodoroLongBreakColor';

export interface StreamRadioSettings {
  showStationLogos: boolean;
  favorites: FavoriteStation[];
  activeStationId: string;
  volume: number;
  muted: boolean;
  lastVolume: number;
  pomodoroEnabled: boolean;
  pomodoroReducedDistractionEnabled: boolean;
  pomodoroDimFactor: number;
  pomodoroFocusMinutes: number;
  pomodoroTimerColor: string;
  pomodoroIntervals: number;
  pomodoroShortBreakMinutes: number;
  pomodoroShortBreakColor: string;
  pomodoroLongBreakMinutes: number;
  pomodoroLongBreakColor: string;
  pomodoroLongBreakEvery: number;
  pomodoroHidden: boolean;
  pomodoroManualDimEnabled: boolean;
}

export interface PomodoroSessionState {
  phase: PomodoroPhase;
  currentIntervalIndex: number;
  completedIntervals: number;
  remainingSeconds: number;
  durationSeconds: number;
  isRunning: boolean;
}

export interface IcyTrackMetadata {
  title: string;
  artist: string;
}

export interface FavoriteStation {
  stationuuid: string;
  name: string;
  streamUrl: string;
  favicon: string;
  homepage: string;
  tags: string;
  codec: string;
  bitrate: number;
  country: string;
  language: string;
}

export interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url_resolved?: string;
  url?: string;
  favicon?: string;
  homepage?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
  country?: string;
  language?: string;
}

export interface RadioBrowserFacet {
  name: string;
  stationcount?: number;
}

export interface RadioBrowserServerStats {
  stations?: number;
}

export interface SearchFilters {
  name: string;
  country: string;
  language: string;
  tag: string;
}

export interface StationLogoOptions {
  imageClass: string;
  fallbackClass: string;
  wrapperClass: string;
  loading?: 'lazy' | 'eager';
  websiteUrl?: string;
}

export interface ObsidianSettingsWindow {
  open(): void;
  openTabById(id: string): void;
}

export interface AppWithSettings extends App {
  setting?: ObsidianSettingsWindow;
}
