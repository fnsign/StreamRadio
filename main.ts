import {
  App,
  ButtonComponent,
  Component,
  DropdownComponent,
  ItemView,
  MarkdownRenderer,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  setIcon,
  Setting,
  TextComponent,
  WorkspaceLeaf,
} from 'obsidian';
import releaseNotes from './RELEASENOTES.md';

const VIEW_TYPE_STREAMRADIO = 'streamradio-player-view';
const RADIO_BROWSER_BASE_URL = 'https://all.api.radio-browser.info/json';
const SEARCH_PAGE_SIZE = 20;
const SEARCH_COUNT_LIMIT = 100000;
const TIMER_REFRESH_INTERVAL_MS = 30000;
const POMODORO_REFRESH_INTERVAL_MS = 1000;
const POMODORO_DIM_DELAY_SECONDS = 10;
const POMODORO_RESTORE_BEFORE_END_SECONDS = 60;
const MAX_VISIBLE_TAGS = 6;
const LEGACY_DEFAULT_POMODORO_FOCUS_COLOR = '#7c3aed';
const DEFAULT_POMODORO_SHORT_BREAK_COLOR = '#003f88';
const DEFAULT_POMODORO_LONG_BREAK_COLOR = '#0b5d1e';

type SettingsSection = 'radio' | 'pomodoro';
type PomodoroPhase = 'focus' | 'short-break' | 'long-break';
type NumberSettingKey = 'pomodoroFocusMinutes' | 'pomodoroIntervals' | 'pomodoroShortBreakMinutes' | 'pomodoroLongBreakMinutes' | 'pomodoroLongBreakEvery' | 'pomodoroDimFactor';
type ColorSettingKey = 'pomodoroTimerColor' | 'pomodoroShortBreakColor' | 'pomodoroLongBreakColor';

interface StreamRadioSettings {
  showStationLogos: boolean;
  favorites: FavoriteStation[];
  activeStationId: string;
  volume: number;
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
}

interface PomodoroSessionState {
  phase: PomodoroPhase;
  currentIntervalIndex: number;
  completedIntervals: number;
  remainingSeconds: number;
  durationSeconds: number;
  isRunning: boolean;
}

interface FavoriteStation {
  stationuuid: string;
  name: string;
  streamUrl: string;
  favicon: string;
  tags: string;
  codec: string;
  bitrate: number;
  country: string;
  language: string;
}

interface RadioBrowserStation {
  stationuuid: string;
  name: string;
  url_resolved?: string;
  url?: string;
  favicon?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
  country?: string;
  language?: string;
}

interface RadioBrowserFacet {
  name: string;
  stationcount?: number;
}

interface SearchFilters {
  name: string;
  country: string;
  language: string;
  tag: string;
}

interface ObsidianSettingsWindow {
  open(): void;
  openTabById(id: string): void;
}

interface AppWithSettings extends App {
  setting?: ObsidianSettingsWindow;
}

const DEFAULT_SETTINGS: StreamRadioSettings = {
  showStationLogos: true,
  favorites: [],
  activeStationId: '',
  volume: 1,
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
};

function toFavoriteStation(station: RadioBrowserStation): FavoriteStation {
  return {
    stationuuid: station.stationuuid,
    name: station.name || 'Unnamed station',
    streamUrl: station.url_resolved || station.url || '',
    favicon: station.favicon || '',
    tags: station.tags || '',
    codec: station.codec || '',
    bitrate: station.bitrate || 0,
    country: station.country || '',
    language: station.language || '',
  };
}

function stationFormat(station: Pick<FavoriteStation, 'tags' | 'codec'>): string {
  if (station.tags.trim()) {
    return station.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, MAX_VISIBLE_TAGS).join(', ');
  }

  return station.codec || 'Unknown format';
}

function bitrateLabel(bitrate: number): string {
  return bitrate > 0 ? `${bitrate} kbps` : 'Unknown bitrate';
}

function normalizeFacetName(name: string): string {
  return name.trim();
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_SETTINGS.volume;
  }

  return Math.min(1, Math.max(0, volume));
}

function clampInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clampPercentage(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(5, Math.round(value)));
}

function sanitizeColor(value: string, fallback: string): string {
  if (!value) {
    return fallback;
  }

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function getThemeAccentColor(): string {
  const bodyStyle = getComputedStyle(document.body);
  const rootStyle = getComputedStyle(document.documentElement);
  const hue = getCssVariableNumber(bodyStyle, rootStyle, '--accent-h');
  const saturation = getCssVariableNumber(bodyStyle, rootStyle, '--accent-s');
  const lightness = getCssVariableNumber(bodyStyle, rootStyle, '--accent-l');

  if (hue !== null && saturation !== null && lightness !== null) {
    return hslToHex(hue, saturation, lightness);
  }

  const color = bodyStyle.getPropertyValue('--interactive-accent').trim();
  return cssColorToHex(color) || LEGACY_DEFAULT_POMODORO_FOCUS_COLOR;
}

function getCssVariableNumber(bodyStyle: CSSStyleDeclaration, rootStyle: CSSStyleDeclaration, name: string): number | null {
  const value = bodyStyle.getPropertyValue(name).trim() || rootStyle.getPropertyValue(name).trim();
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360 / 360;
  const normalizedSaturation = Math.min(1, Math.max(0, saturation / 100));
  const normalizedLightness = Math.min(1, Math.max(0, lightness / 100));

  const hueToRgb = (lowerBound: number, upperBound: number, hueOffset: number): number => {
    let adjusted = hueOffset;
    if (adjusted < 0) {
      adjusted += 1;
    }
    if (adjusted > 1) {
      adjusted -= 1;
    }
    if (adjusted < 1 / 6) {
      return lowerBound + (upperBound - lowerBound) * 6 * adjusted;
    }
    if (adjusted < 1 / 2) {
      return upperBound;
    }
    if (adjusted < 2 / 3) {
      return lowerBound + (upperBound - lowerBound) * (2 / 3 - adjusted) * 6;
    }
    return lowerBound;
  };

  const upperBound = normalizedLightness < 0.5
    ? normalizedLightness * (1 + normalizedSaturation)
    : normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation;
  const lowerBound = 2 * normalizedLightness - upperBound;
  const red = hueToRgb(lowerBound, upperBound, normalizedHue + 1 / 3);
  const green = hueToRgb(lowerBound, upperBound, normalizedHue);
  const blue = hueToRgb(lowerBound, upperBound, normalizedHue - 1 / 3);

  return [red, green, blue]
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
    .join('')
    .replace(/^/, '#');
}

function cssColorToHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color;
  }

  const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return '';
  }

  return [match[1], match[2], match[3]]
    .map((channel) => Math.min(255, Math.max(0, Number(channel))).toString(16).padStart(2, '0'))
    .join('')
    .replace(/^/, '#');
}

function formatPomodoroTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function secondsFromMinutes(minutes: number): number {
  return Math.max(1, minutes) * 60;
}

export default class StreamRadioPlugin extends Plugin {
  settings: StreamRadioSettings = DEFAULT_SETTINGS;
  private audio: HTMLAudioElement | null = null;
  private isPlaying = false;
  private sleepTimerId: number | null = null;
  private sleepTimerRefreshId: number | null = null;
  private sleepTimerEndsAt = 0;
  private pomodoroSession: PomodoroSessionState | null = null;
  private pomodoroTickId: number | null = null;
  private pomodoroBreakWarningSecond = 0;
  private pomodoroBeepTimeoutIds: number[] = [];
  private beepAudioContext: AudioContext | null = null;
  private pomodoroHidden = false;
  private pomodoroManualDimEnabled = false;
  private pomodoroAutoDimSuppressed = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_STREAMRADIO, (leaf) => new StreamRadioPlayerView(leaf, this));

    this.addRibbonIcon('radio', 'Open StreamRadio', () => {
      void this.activatePlayerView();
    });

    this.addCommand({
      id: 'open-streamradio-player',
      name: 'Open StreamRadio player',
      callback: () => {
        void this.activatePlayerView();
      },
    });

    this.addSettingTab(new StreamRadioSettingTab(this.app, this));
  }

  onunload(): void {
    this.stopPlayback();
    this.clearSleepTimer();
    this.clearPomodoroTimer();
    this.clearPomodoroBeeps();
    void this.beepAudioContext?.close();
  }

  async loadSettings(): Promise<void> {
    const loadedSettings = await this.loadData() as Partial<StreamRadioSettings> | null;
    const themeAccentColor = getThemeAccentColor();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings);
    this.settings.favorites = this.settings.favorites
      .filter((station) => station.stationuuid && station.streamUrl);
    this.settings.volume = clampVolume(this.settings.volume ?? DEFAULT_SETTINGS.volume);
    this.settings.pomodoroEnabled = this.settings.pomodoroEnabled ?? DEFAULT_SETTINGS.pomodoroEnabled;
    this.settings.pomodoroReducedDistractionEnabled = this.settings.pomodoroReducedDistractionEnabled ?? DEFAULT_SETTINGS.pomodoroReducedDistractionEnabled;
    this.settings.pomodoroDimFactor = clampPercentage(this.settings.pomodoroDimFactor, DEFAULT_SETTINGS.pomodoroDimFactor);
    this.settings.pomodoroFocusMinutes = clampInteger(this.settings.pomodoroFocusMinutes, DEFAULT_SETTINGS.pomodoroFocusMinutes, 1, 240);
    this.settings.pomodoroTimerColor = !loadedSettings?.pomodoroTimerColor || loadedSettings.pomodoroTimerColor === LEGACY_DEFAULT_POMODORO_FOCUS_COLOR
      ? themeAccentColor
      : sanitizeColor(this.settings.pomodoroTimerColor, themeAccentColor);
    this.settings.pomodoroIntervals = clampInteger(this.settings.pomodoroIntervals, DEFAULT_SETTINGS.pomodoroIntervals, 1, 8);
    this.settings.pomodoroShortBreakMinutes = clampInteger(this.settings.pomodoroShortBreakMinutes, DEFAULT_SETTINGS.pomodoroShortBreakMinutes, 1, 120);
    this.settings.pomodoroShortBreakColor = sanitizeColor(this.settings.pomodoroShortBreakColor, DEFAULT_SETTINGS.pomodoroShortBreakColor);
    this.settings.pomodoroLongBreakMinutes = clampInteger(this.settings.pomodoroLongBreakMinutes, DEFAULT_SETTINGS.pomodoroLongBreakMinutes, 1, 240);
    this.settings.pomodoroLongBreakColor = sanitizeColor(this.settings.pomodoroLongBreakColor, DEFAULT_SETTINGS.pomodoroLongBreakColor);
    this.settings.pomodoroLongBreakEvery = clampInteger(this.settings.pomodoroLongBreakEvery, DEFAULT_SETTINGS.pomodoroLongBreakEvery, 1, 8);
  }

  async saveSettings(): Promise<void> {
    if (!this.settings.favorites.some((station) => station.stationuuid === this.settings.activeStationId)) {
      this.settings.activeStationId = this.settings.favorites[0]?.stationuuid || '';
    }

    this.settings.pomodoroIntervals = clampInteger(this.settings.pomodoroIntervals, DEFAULT_SETTINGS.pomodoroIntervals, 1, 8);
    this.settings.pomodoroLongBreakEvery = clampInteger(this.settings.pomodoroLongBreakEvery, DEFAULT_SETTINGS.pomodoroLongBreakEvery, 1, 8);
    this.settings.pomodoroDimFactor = clampPercentage(this.settings.pomodoroDimFactor, DEFAULT_SETTINGS.pomodoroDimFactor);

    if (!this.settings.pomodoroEnabled) {
      this.pomodoroHidden = false;
      this.resetPomodoro(false);
    }

    await this.saveData(this.settings);
    this.refreshPlayerViews();
  }

  getCurrentStation(): FavoriteStation | null {
    return this.settings.favorites.find((station) => station.stationuuid === this.settings.activeStationId)
      || this.settings.favorites[0]
      || null;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getSleepTimerLabel(): string {
    if (!this.sleepTimerEndsAt) {
      return '';
    }

    const remainingMs = Math.max(0, this.sleepTimerEndsAt - Date.now());
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    return `Timer: ${remainingMinutes} min. remaining`;
  }

  getVolume(): number {
    return clampVolume(this.settings.volume);
  }

  async setVolume(volume: number, persist = false): Promise<void> {
    this.settings.volume = clampVolume(volume);
    if (this.audio) {
      this.audio.volume = this.settings.volume;
    }

    if (persist) {
      await this.saveSettings();
    }
  }

  openSettingsTab(): void {
    const settingsWindow = (this.app as AppWithSettings).setting;
    if (!settingsWindow) {
      new Notice('StreamRadio could not open plugin settings.');
      return;
    }

    settingsWindow.open();
    settingsWindow.openTabById(this.manifest.id);
  }

  getIsPomodoroHidden(): boolean {
    return this.pomodoroHidden;
  }

  togglePomodoroVisibility(): void {
    this.pomodoroHidden = !this.pomodoroHidden;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAMRADIO)) {
      if (leaf.view instanceof StreamRadioPlayerView) {
        leaf.view.updatePomodoroToolbar();
      }
    }
  }

  getIsPomodoroDisplayDimmed(session = this.getPomodoroSession()): boolean {
    return this.pomodoroManualDimEnabled || (this.shouldAutoDimPomodoro(session) && !this.pomodoroAutoDimSuppressed);
  }

  togglePomodoroDisplayDim(): void {
    const session = this.getPomodoroSession();
    const isAutoDimmed = this.shouldAutoDimPomodoro(session);
    const isDisplayDimmed = this.getIsPomodoroDisplayDimmed(session);

    if (isDisplayDimmed) {
      this.pomodoroManualDimEnabled = false;
      this.pomodoroAutoDimSuppressed = isAutoDimmed;
    } else if (isAutoDimmed) {
      this.pomodoroAutoDimSuppressed = false;
    } else {
      this.pomodoroManualDimEnabled = true;
      this.pomodoroAutoDimSuppressed = false;
    }

    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAMRADIO)) {
      if (leaf.view instanceof StreamRadioPlayerView) {
        leaf.view.updatePomodoroToolbar();
      }
    }
  }

  private shouldAutoDimPomodoro(session: PomodoroSessionState): boolean {
    if (!this.settings.pomodoroReducedDistractionEnabled || session.phase !== 'focus' || !session.isRunning) {
      return false;
    }

    const elapsedSeconds = session.durationSeconds - session.remainingSeconds;
    return elapsedSeconds >= POMODORO_DIM_DELAY_SECONDS && session.remainingSeconds > POMODORO_RESTORE_BEFORE_END_SECONDS;
  }

  async activatePlayerView(): Promise<void> {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAMRADIO);
    if (existingLeaves.length > 0) {
      this.app.workspace.revealLeaf(existingLeaves[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice('StreamRadio could not open the right sidebar.');
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE_STREAMRADIO, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async togglePlayback(): Promise<void> {
    if (this.isPlaying) {
      this.pausePlayback();
      return;
    }

    const station = this.getCurrentStation();
    if (!station) {
      new Notice('Add a favorite station before starting playback.');
      return;
    }

    await this.playStation(station);
  }

  async selectStation(station: FavoriteStation): Promise<void> {
    const shouldContinuePlayback = this.isPlaying;
    this.settings.activeStationId = station.stationuuid;
    await this.saveSettings();

    if (shouldContinuePlayback) {
      await this.playStation(station);
    } else {
      this.refreshPlayerViews();
    }
  }

  async playNextStation(): Promise<void> {
    await this.playRelativeStation(1);
  }

  async playPreviousStation(): Promise<void> {
    await this.playRelativeStation(-1);
  }

  private async playRelativeStation(direction: 1 | -1): Promise<void> {
    const favorites = this.settings.favorites;
    if (favorites.length === 0) {
      new Notice('Add a favorite station first.');
      return;
    }

    const current = this.getCurrentStation();
    const currentIndex = current ? favorites.findIndex((station) => station.stationuuid === current.stationuuid) : -1;
    const nextStation = favorites[(currentIndex + direction + favorites.length) % favorites.length];
    await this.selectStation(nextStation);
  }

  async playStation(station: FavoriteStation): Promise<void> {
    if (!station.streamUrl) {
      new Notice('This station has no playable stream URL.');
      return;
    }

    this.stopAudioElement();
    this.settings.activeStationId = station.stationuuid;

    const audio = new Audio(station.streamUrl);
    audio.preload = 'none';
    audio.volume = this.getVolume();
    audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.refreshPlayerViews();
    });
    audio.addEventListener('pause', () => {
      if (this.audio === audio && !audio.ended) {
        this.isPlaying = false;
        this.refreshPlayerViews();
      }
    });
    audio.addEventListener('playing', () => {
      if (this.audio === audio) {
        this.isPlaying = true;
        this.refreshPlayerViews();
      }
    });
    audio.addEventListener('error', () => {
      if (this.audio === audio) {
        this.isPlaying = false;
        this.refreshPlayerViews();
        new Notice(`Could not play ${station.name}.`);
      }
    });

    this.audio = audio;

    try {
      await audio.play();
      this.isPlaying = true;
      await this.saveSettings();
    } catch (error) {
      this.isPlaying = false;
      this.refreshPlayerViews();
      new Notice(`Could not start ${station.name}.`);
    }
  }

  pausePlayback(): void {
    if (this.audio) {
      this.audio.pause();
    }

    this.isPlaying = false;
    this.refreshPlayerViews();
  }

  stopPlayback(): void {
    this.stopAudioElement();
    this.isPlaying = false;
    this.refreshPlayerViews();
  }

  startSleepTimer(minutes: number): void {
    this.clearSleepTimer();

    const safeMinutes = Math.max(1, Math.floor(minutes));
    this.sleepTimerEndsAt = Date.now() + safeMinutes * 60000;
    this.sleepTimerId = window.setTimeout(() => {
      this.stopPlayback();
      this.clearSleepTimer();
      new Notice('StreamRadio sleep timer stopped playback.');
    }, safeMinutes * 60000);
    this.sleepTimerRefreshId = window.setInterval(() => {
      this.refreshPlayerViews();
    }, TIMER_REFRESH_INTERVAL_MS);

    this.refreshPlayerViews();
  }

  clearSleepTimer(): void {
    if (this.sleepTimerId !== null) {
      window.clearTimeout(this.sleepTimerId);
    }
    if (this.sleepTimerRefreshId !== null) {
      window.clearInterval(this.sleepTimerRefreshId);
    }

    this.sleepTimerId = null;
    this.sleepTimerRefreshId = null;
    this.sleepTimerEndsAt = 0;
    this.refreshPlayerViews();
  }

  getPomodoroSession(): PomodoroSessionState {
    if (!this.pomodoroSession) {
      this.pomodoroSession = this.createPomodoroSession('focus', 0, 0, false);
    }

    return this.pomodoroSession;
  }

  togglePomodoro(): void {
    const session = this.getPomodoroSession();
    session.isRunning = !session.isRunning;

    if (session.isRunning) {
      this.startPomodoroTimer();
    } else {
      this.clearPomodoroTimer();
    }

    this.refreshPomodoroViews();
  }

  resetCurrentPomodoroInterval(): void {
    const session = this.getPomodoroSession();
    this.pomodoroSession = this.createPomodoroSession('focus', session.currentIntervalIndex, session.completedIntervals, session.isRunning);
    this.pomodoroBreakWarningSecond = 0;
    if (this.pomodoroSession.isRunning) {
      this.startPomodoroTimer();
    }

    this.refreshPomodoroViews();
  }

  skipToNextPomodoroInterval(): void {
    const session = this.getPomodoroSession();
    const nextIndex = Math.min(this.settings.pomodoroIntervals, Math.max(session.currentIntervalIndex + 1, session.completedIntervals));

    if (nextIndex >= this.settings.pomodoroIntervals) {
      this.completePomodoroSession();
      this.refreshPomodoroViews();
      return;
    }

    this.pomodoroSession = this.createPomodoroSession('focus', nextIndex, nextIndex, session.isRunning);
    this.pomodoroBreakWarningSecond = 0;
    if (this.pomodoroSession.isRunning) {
      this.startPomodoroTimer();
    }

    this.refreshPomodoroViews();
  }

  resetPomodoro(refresh = true): void {
    this.clearPomodoroTimer();
    this.clearPomodoroBeeps();
    this.pomodoroBreakWarningSecond = 0;
    this.pomodoroSession = this.createPomodoroSession('focus', 0, 0, false);

    if (refresh) {
      this.refreshPomodoroViews();
    }
  }

  async saveFavorites(favorites: FavoriteStation[]): Promise<void> {
    this.settings.favorites = favorites;
    await this.saveSettings();
  }

  refreshPlayerViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAMRADIO)) {
      if (leaf.view instanceof StreamRadioPlayerView) {
        leaf.view.render();
      }
    }
  }

  refreshPomodoroViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAMRADIO)) {
      if (leaf.view instanceof StreamRadioPlayerView) {
        leaf.view.renderPomodoroOnly();
      }
    }
  }

  refreshPomodoroDisplays(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAMRADIO)) {
      if (leaf.view instanceof StreamRadioPlayerView) {
        leaf.view.updatePomodoroDisplay();
      }
    }
  }

  private stopAudioElement(): void {
    if (!this.audio) {
      return;
    }

    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio = null;
  }

  private startPomodoroTimer(): void {
    this.clearPomodoroTimer();
    this.pomodoroTickId = window.setInterval(() => {
      this.tickPomodoro();
    }, POMODORO_REFRESH_INTERVAL_MS);
  }

  private clearPomodoroTimer(): void {
    if (this.pomodoroTickId !== null) {
      window.clearInterval(this.pomodoroTickId);
    }

    this.pomodoroTickId = null;
  }

  private tickPomodoro(): void {
    const session = this.getPomodoroSession();
    if (!session.isRunning) {
      return;
    }

    if (session.remainingSeconds <= 3 && session.remainingSeconds > 0 && this.pomodoroBreakWarningSecond !== session.remainingSeconds) {
      this.pomodoroBreakWarningSecond = session.remainingSeconds;
      this.playBeep();
    }

    session.remainingSeconds -= 1;

    if (session.remainingSeconds <= 0) {
      this.advancePomodoroPhase(session);
      this.refreshPomodoroViews();
      return;
    }

    this.refreshPomodoroDisplays();
  }

  private advancePomodoroPhase(session: PomodoroSessionState): void {
    this.pomodoroBreakWarningSecond = 0;

    if (session.phase === 'focus') {
      const completedIntervals = session.completedIntervals + 1;
      this.playPomodoroCompletionBeeps();

      if (completedIntervals >= this.settings.pomodoroIntervals) {
        this.completePomodoroSession();
        return;
      }

      const nextPhase: PomodoroPhase = completedIntervals % this.settings.pomodoroLongBreakEvery === 0 ? 'long-break' : 'short-break';
      this.pomodoroSession = this.createPomodoroSession(nextPhase, completedIntervals, completedIntervals, true);
      return;
    }

    this.pomodoroSession = this.createPomodoroSession('focus', session.completedIntervals, session.completedIntervals, true);
  }

  private completePomodoroSession(): void {
    this.clearPomodoroTimer();
    const completedIntervals = this.settings.pomodoroIntervals;
    this.pomodoroSession = {
      phase: 'focus',
      currentIntervalIndex: Math.max(0, completedIntervals - 1),
      completedIntervals,
      remainingSeconds: 0,
      durationSeconds: secondsFromMinutes(this.settings.pomodoroFocusMinutes),
      isRunning: false,
    };
    new Notice('Pomodoro session complete.');
  }

  private createPomodoroSession(phase: PomodoroPhase, currentIntervalIndex: number, completedIntervals: number, isRunning: boolean): PomodoroSessionState {
    const durationSeconds = this.getPomodoroPhaseDurationSeconds(phase);
    this.pomodoroAutoDimSuppressed = false;
    return {
      phase,
      currentIntervalIndex,
      completedIntervals,
      remainingSeconds: durationSeconds,
      durationSeconds,
      isRunning,
    };
  }

  private getPomodoroPhaseDurationSeconds(phase: PomodoroPhase): number {
    if (phase === 'long-break') {
      return secondsFromMinutes(this.settings.pomodoroLongBreakMinutes);
    }

    if (phase === 'short-break') {
      return secondsFromMinutes(this.settings.pomodoroShortBreakMinutes);
    }

    return secondsFromMinutes(this.settings.pomodoroFocusMinutes);
  }

  private playPomodoroCompletionBeeps(): void {
    this.clearPomodoroBeeps();
    [0, 250, 500].forEach((delay) => {
      const timeoutId = window.setTimeout(() => {
        this.playBeep();
      }, delay);
      this.pomodoroBeepTimeoutIds.push(timeoutId);
    });
  }

  private clearPomodoroBeeps(): void {
    this.pomodoroBeepTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    this.pomodoroBeepTimeoutIds = [];
  }

  private playBeep(): void {
    if (!window.AudioContext) {
      return;
    }

    if (!this.beepAudioContext) {
      this.beepAudioContext = new AudioContext();
    }

    const context = this.beepAudioContext;
    void context.resume();

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startTime = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.12, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.12);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.14);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
    });
  }
}

class StreamRadioSettingTab extends PluginSettingTab {
  private activeSection: SettingsSection = 'radio';

  constructor(app: App, private plugin: StreamRadioPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderTabs(containerEl);

    if (this.activeSection === 'pomodoro') {
      this.renderPomodoroSection(containerEl);
      return;
    }

    this.renderRadioSection(containerEl);
  }

  private renderTabs(containerEl: HTMLElement): void {
    const tabs = containerEl.createDiv({ cls: 'streamradio-settings-tabs' });
    this.createSettingsTab(tabs, 'radio', 'Radio');
    this.createSettingsTab(tabs, 'pomodoro', 'Pomodoro');
  }

  private createSettingsTab(parent: HTMLElement, section: SettingsSection, label: string): void {
    const button = parent.createEl('button', {
      cls: `streamradio-settings-tab${this.activeSection === section ? ' is-active' : ''}`,
      text: label,
      attr: { type: 'button' },
    });
    button.addEventListener('click', () => {
      this.activeSection = section;
      this.display();
    });
  }

  private renderRadioSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Radio').setHeading();

    new Setting(containerEl)
      .setName('Release notes')
      .setDesc('Show the bundled release notes for StreamRadio.')
      .addButton((button) => {
        button
          .setButtonText('Show release notes')
          .setCta()
          .onClick(() => new ReleaseNotesModal(this.app).open());
      });

    new Setting(containerEl)
      .setName('Show station logos')
      .setDesc('Show station logos in the player when a station provides one.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showStationLogos)
          .onChange(async (value) => {
            this.plugin.settings.showStationLogos = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Favorite stations')
      .setDesc('Add and arrange favorite stations.')
      .addButton((button) => {
        button
          .setButtonText('Add favorites')
          .setCta()
          .onClick(() => {
            new StationSearchModal(this.app, this.plugin, () => this.display()).open();
          });
      });

    this.renderFavoriteList(containerEl);
  }

  private renderPomodoroSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Pomodoro').setHeading();

    new Setting(containerEl)
      .setName('Enable Pomodoro timer')
      .setDesc('Show the Pomodoro timer below the radio controls.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.pomodoroEnabled)
          .onChange(async (value) => {
            this.plugin.settings.pomodoroEnabled = value;
            await this.plugin.saveSettings();
          });
      });

    this.addNumberSetting(containerEl, 'Focus duration', 'Duration of one Pomodoro interval in minutes.', 'pomodoroFocusMinutes', 1, 240);
    this.addColorSetting(containerEl, 'Focus color', 'Color used for the focus indicator and interval markers.', 'pomodoroTimerColor', getThemeAccentColor(), true);
    this.addReducedDistractionSettings(containerEl);
    this.addNumberSetting(containerEl, 'Intervals', 'Number of focus intervals in one Pomodoro session.', 'pomodoroIntervals', 1, 8);
    this.addNumberSetting(containerEl, 'Short break duration', 'Duration of a short break in minutes.', 'pomodoroShortBreakMinutes', 1, 120);
    this.addColorSetting(containerEl, 'Short break color', 'Color used for the short break indicator and interval markers.', 'pomodoroShortBreakColor', DEFAULT_POMODORO_SHORT_BREAK_COLOR, true);
    this.addNumberSetting(containerEl, 'Long break duration', 'Duration of a long break in minutes.', 'pomodoroLongBreakMinutes', 1, 240);
    this.addColorSetting(containerEl, 'Long break color', 'Color used for the long break indicator and interval markers.', 'pomodoroLongBreakColor', DEFAULT_POMODORO_LONG_BREAK_COLOR, true);
    this.addNumberSetting(containerEl, 'Long break after intervals', 'Number of completed intervals before a long break starts.', 'pomodoroLongBreakEvery', 1, 8);
  }

  private addNumberSetting(containerEl: HTMLElement, name: string, description: string, key: NumberSettingKey, min: number, max: number): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        const saveValue = async () => {
          const parsed = Number(text.getValue());
          if (!Number.isFinite(parsed)) {
            text.setValue(String(this.plugin.settings[key]));
            return;
          }

          const fallback = Number(DEFAULT_SETTINGS[key]);
          this.plugin.settings[key] = clampInteger(parsed, fallback, min, max);
          await this.plugin.saveSettings();
          text.setValue(String(this.plugin.settings[key]));
        };

        text.setValue(String(this.plugin.settings[key]));
        text.inputEl.setAttr('type', 'number');
        text.inputEl.setAttr('min', String(min));
        text.inputEl.setAttr('max', String(max));
        text.inputEl.setAttr('step', '1');
        text.inputEl.addClass('streamradio-number-input');
        text.inputEl.addEventListener('change', () => {
          void saveValue();
        });
        text.inputEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            text.inputEl.blur();
            void saveValue();
          }
        });
      });
  }

  private addColorSetting(containerEl: HTMLElement, name: string, description: string, key: ColorSettingKey, fallback: string, isNested = false): void {
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addColorPicker((picker) => {
        picker
          .setValue(String(this.plugin.settings[key] || fallback))
          .onChange(async (value) => {
            this.plugin.settings[key] = sanitizeColor(value, fallback);
            await this.plugin.saveSettings();
          });
      });

    if (isNested) {
      setting.settingEl.addClass('streamradio-nested-setting');
    }
  }

  private addReducedDistractionSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Reduced distraction mode')
      .setDesc('Dim the Pomodoro display during focus intervals after the first 10 seconds, then restore it one minute before the interval ends.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.pomodoroReducedDistractionEnabled)
          .onChange(async (value) => {
            this.plugin.settings.pomodoroReducedDistractionEnabled = value;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (!this.plugin.settings.pomodoroReducedDistractionEnabled) {
      return;
    }

    const dimSetting = new Setting(containerEl)
      .setName(`Dim factor (${this.plugin.settings.pomodoroDimFactor}%)`)
      .setDesc('Display brightness while reduced distraction mode is active.');
    dimSetting.settingEl.addClass('streamradio-nested-setting');

    dimSetting.addSlider((slider) => {
      slider
        .setLimits(5, 100, 5)
        .setValue(this.plugin.settings.pomodoroDimFactor)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.pomodoroDimFactor = clampPercentage(value, DEFAULT_SETTINGS.pomodoroDimFactor);
          dimSetting.setName(`Dim factor (${this.plugin.settings.pomodoroDimFactor}%)`);
          await this.plugin.saveSettings();
        });
    });
  }

  private renderFavoriteList(containerEl: HTMLElement): void {
    const list = containerEl.createDiv({ cls: 'streamradio-favorite-list' });

    if (this.plugin.settings.favorites.length === 0) {
      list.createDiv({ cls: 'streamradio-empty-state', text: 'No favorite stations yet.' });
      return;
    }

    this.plugin.settings.favorites.forEach((station, index) => {
      const row = list.createDiv({ cls: 'streamradio-favorite-row' });
      row.setAttr('draggable', 'true');
      row.setAttr('data-index', String(index));

      const handle = row.createSpan({ cls: 'streamradio-drag-handle' });
      setIcon(handle, 'grip-vertical');

      this.createStationLogo(row, station);

      const text = row.createDiv({ cls: 'streamradio-favorite-text' });
      text.createDiv({ cls: 'streamradio-station-name', text: station.name });
      text.createDiv({ cls: 'streamradio-station-meta', text: `${stationFormat(station)} · ${bitrateLabel(station.bitrate)}` });

      const actions = row.createDiv({ cls: 'streamradio-row-actions' });
      const isActiveStationPlaying = this.plugin.getIsPlaying() && this.plugin.getCurrentStation()?.stationuuid === station.stationuuid;
      const playButton = actions.createEl('button', { cls: 'clickable-icon streamradio-icon-button', attr: { type: 'button', 'aria-label': isActiveStationPlaying ? `Stop ${station.name}` : `Play ${station.name}` } });
      setIcon(playButton, isActiveStationPlaying ? 'square' : 'play');
      playButton.addEventListener('click', async () => {
        if (isActiveStationPlaying) {
          this.plugin.stopPlayback();
        } else {
          await this.plugin.selectStation(station);
          await this.plugin.playStation(station);
        }

        this.display();
      });

      const removeButton = actions.createEl('button', { cls: 'clickable-icon streamradio-icon-button', attr: { type: 'button', 'aria-label': `Remove ${station.name}` } });
      setIcon(removeButton, 'trash-2');
      removeButton.addEventListener('click', async () => {
        const favorites = this.plugin.settings.favorites.filter((favorite) => favorite.stationuuid !== station.stationuuid);
        await this.plugin.saveFavorites(favorites);
        this.display();
      });

      row.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', String(index));
        event.dataTransfer?.setDragImage(row, 12, 12);
        row.addClass('is-dragging');
      });

      row.addEventListener('dragend', () => {
        row.removeClass('is-dragging');
      });

      row.addEventListener('dragover', (event) => {
        event.preventDefault();
      });

      row.addEventListener('drop', async (event) => {
        event.preventDefault();
        const fromIndex = Number(event.dataTransfer?.getData('text/plain'));
        const toIndex = index;
        if (!Number.isInteger(fromIndex) || fromIndex === toIndex) {
          return;
        }

        const favorites = [...this.plugin.settings.favorites];
        const [moved] = favorites.splice(fromIndex, 1);
        favorites.splice(toIndex, 0, moved);
        await this.plugin.saveFavorites(favorites);
        this.display();
      });
    });
  }

  private createStationLogo(parent: HTMLElement, station: FavoriteStation): void {
    if (!station.favicon) {
      const fallback = parent.createDiv({ cls: 'streamradio-logo-fallback' });
      setIcon(fallback, 'radio');
      return;
    }

    parent.createEl('img', {
      cls: 'streamradio-station-logo',
      attr: {
        src: station.favicon,
        alt: '',
        loading: 'lazy',
      },
    });
  }
}

class StreamRadioPlayerView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: StreamRadioPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_STREAMRADIO;
  }

  getDisplayText(): string {
    return 'StreamRadio';
  }

  getIcon(): string {
    return 'radio';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  renderPomodoroOnly(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.querySelector('.streamradio-pomodoro')?.remove();
    this.renderPomodoro(container);
  }

  updatePomodoroDisplay(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    const wrapper = container.querySelector<HTMLElement>('.streamradio-pomodoro');
    if (!wrapper) {
      this.renderPomodoroOnly();
      return;
    }

    const session = this.plugin.getPomodoroSession();
    if (wrapper.dataset.phase !== session.phase) {
      this.renderPomodoroOnly();
      return;
    }

    this.applyPomodoroColors(wrapper, session.phase);
    this.applyPomodoroVisibility(wrapper, session);
    this.updatePomodoroRing(wrapper, session);

    const timeEl = wrapper.querySelector<HTMLElement>('.streamradio-pomodoro-time');
    if (timeEl) {
      timeEl.setText(formatPomodoroTime(session.remainingSeconds));
    }

    this.updatePomodoroToolStates(container, session);
  }

  updatePomodoroToolbar(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    const session = this.plugin.getPomodoroSession();
    const wrapper = container.querySelector<HTMLElement>('.streamradio-pomodoro');
    if (wrapper) {
      this.applyPomodoroVisibility(wrapper, session);
    }

    this.updatePomodoroToolStates(container, session);
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('streamradio-player');

    const station = this.plugin.getCurrentStation();
    if (!station) {
      container.createDiv({ cls: 'streamradio-empty-state', text: 'Add favorite stations in StreamRadio settings.' });
      this.renderSelectionButton(container);
      this.renderPomodoro(container);
      return;
    }

    const header = container.createDiv({ cls: 'streamradio-player-header' });
    if (this.plugin.settings.showStationLogos) {
      this.createStationLogo(header, station);
    }

    const details = header.createDiv({ cls: 'streamradio-player-details' });
    details.createDiv({ cls: 'streamradio-player-title', text: station.name });
    const infoParts = [station.country, station.language].filter(Boolean).join(' · ');
    details.createDiv({ cls: 'streamradio-station-meta', text: infoParts || 'Station information unavailable' });
    details.createDiv({ cls: 'streamradio-station-meta', text: `${stationFormat(station)} · ${bitrateLabel(station.bitrate)}` });

    const controls = container.createDiv({ cls: 'streamradio-controls' });
    const previousButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': 'Previous station' } });
    setIcon(previousButton, 'skip-back');
    previousButton.addEventListener('click', () => {
      void this.plugin.playPreviousStation();
    });

    const playButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': this.plugin.getIsPlaying() ? 'Pause stream' : 'Start stream' } });
    setIcon(playButton, this.plugin.getIsPlaying() ? 'pause' : 'play');
    playButton.addEventListener('click', () => {
      void this.plugin.togglePlayback();
    });

    const nextButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': 'Next station' } });
    setIcon(nextButton, 'skip-forward');
    nextButton.addEventListener('click', () => {
      void this.plugin.playNextStation();
    });

    const selectButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': 'Select station' } });
    setIcon(selectButton, 'list-music');
    selectButton.addEventListener('click', () => {
      new StationPickerModal(this.app, this.plugin).open();
    });

    const timerButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': 'Set sleep timer' } });
    setIcon(timerButton, 'timer');
    timerButton.addEventListener('click', () => {
      new SleepTimerModal(this.app, this.plugin).open();
    });

    const settingsButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': 'Open StreamRadio settings' } });
    setIcon(settingsButton, 'settings');
    settingsButton.addEventListener('click', () => {
      this.plugin.openSettingsTab();
    });

    const volumeControl = container.createDiv({ cls: 'streamradio-volume-control' });
    const volumeIcon = volumeControl.createSpan({ cls: 'streamradio-volume-icon' });
    setIcon(volumeIcon, 'volume-2');
    const volumeSlider = volumeControl.createEl('input', {
      attr: {
        type: 'range',
        min: '0',
        max: '1',
        step: '0.01',
        value: String(this.plugin.getVolume()),
        'aria-label': 'Volume',
      },
    });
    volumeSlider.addEventListener('input', () => {
      void this.plugin.setVolume(Number(volumeSlider.value));
    });
    volumeSlider.addEventListener('change', () => {
      void this.plugin.setVolume(Number(volumeSlider.value), true);
    });

    this.renderPomodoroTools(container);

    const timerLabel = this.plugin.getSleepTimerLabel();
    if (timerLabel) {
      container.createDiv({ cls: 'streamradio-timer-label', text: timerLabel });
    }

    this.renderPomodoro(container);
  }

  private renderSelectionButton(container: HTMLElement): void {
    const button = container.createEl('button', { cls: 'mod-cta streamradio-wide-button', text: 'Select station', attr: { type: 'button' } });
    button.addEventListener('click', () => new StationPickerModal(this.app, this.plugin).open());
  }

  private renderPomodoroTools(container: HTMLElement): void {
    if (!this.plugin.settings.pomodoroEnabled) {
      return;
    }

    const actions = container.createDiv({ cls: 'streamradio-pomodoro-tools' });
    const visibilityButton = actions.createEl('button', {
      cls: 'clickable-icon streamradio-pomodoro-tool-button streamradio-pomodoro-visibility-button',
      attr: {
        type: 'button',
        'aria-label': 'Hide Pomodoro',
        'aria-pressed': 'false',
        title: 'Hide Pomodoro',
      },
    });
    setIcon(visibilityButton, 'eye-off');
    visibilityButton.addEventListener('click', () => {
      this.plugin.togglePomodoroVisibility();
    });

    const dimButton = actions.createEl('button', {
      cls: 'clickable-icon streamradio-pomodoro-tool-button streamradio-pomodoro-dim-button',
      attr: {
        type: 'button',
        'aria-label': 'Dim Pomodoro display',
        'aria-pressed': 'false',
        title: 'Dim Pomodoro display',
      },
    });
    setIcon(dimButton, 'sun-dim');
    dimButton.addEventListener('click', () => {
      this.plugin.togglePomodoroDisplayDim();
    });

    this.updatePomodoroToolbar();
  }

  private updatePomodoroToolStates(container: HTMLElement, session: PomodoroSessionState): void {
    const isHidden = this.plugin.getIsPomodoroHidden();
    const visibilityButton = container.querySelector<HTMLButtonElement>('.streamradio-pomodoro-visibility-button');
    if (visibilityButton) {
      visibilityButton.classList.toggle('is-active', isHidden);
      visibilityButton.setAttr('aria-pressed', String(isHidden));
      visibilityButton.setAttr('aria-label', isHidden ? 'Show Pomodoro' : 'Hide Pomodoro');
      visibilityButton.setAttr('title', isHidden ? 'Show Pomodoro' : 'Hide Pomodoro');
    }

    const isDimmed = this.plugin.getIsPomodoroDisplayDimmed(session);
    const dimButton = container.querySelector<HTMLButtonElement>('.streamradio-pomodoro-dim-button');
    if (dimButton) {
      dimButton.classList.toggle('is-active', isDimmed);
      dimButton.setAttr('aria-pressed', String(isDimmed));
      dimButton.setAttr('aria-label', isDimmed ? 'Show Pomodoro at normal brightness' : 'Dim Pomodoro display');
      dimButton.setAttr('title', isDimmed ? 'Show Pomodoro at normal brightness' : 'Dim Pomodoro display');
    }
  }

  private createStationLogo(parent: HTMLElement, station: FavoriteStation): void {
    if (!station.favicon) {
      const fallback = parent.createDiv({ cls: 'streamradio-player-logo streamradio-logo-fallback' });
      setIcon(fallback, 'radio');
      return;
    }

    parent.createEl('img', {
      cls: 'streamradio-player-logo',
      attr: {
        src: station.favicon,
        alt: '',
      },
    });
  }

  private renderPomodoro(container: HTMLElement): void {
    if (!this.plugin.settings.pomodoroEnabled) {
      return;
    }

    const session = this.plugin.getPomodoroSession();

    const wrapper = container.createDiv({ cls: 'streamradio-pomodoro' });
    wrapper.dataset.phase = session.phase;
    this.applyPomodoroColors(wrapper, session.phase);
    this.applyPomodoroVisibility(wrapper, session);

    const dial = wrapper.createDiv({ cls: 'streamradio-pomodoro-dial' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'streamradio-pomodoro-ring');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('aria-hidden', 'true');

    const elapsedCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    elapsedCircle.setAttribute('class', 'streamradio-pomodoro-ring-elapsed');
    elapsedCircle.setAttribute('cx', '60');
    elapsedCircle.setAttribute('cy', '60');
    elapsedCircle.setAttribute('r', '50');

    const remainingCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    remainingCircle.setAttribute('class', 'streamradio-pomodoro-ring-remaining');
    remainingCircle.setAttribute('cx', '60');
    remainingCircle.setAttribute('cy', '60');
    remainingCircle.setAttribute('r', '50');
    remainingCircle.setAttribute('pathLength', '100');

    const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    point.setAttribute('class', 'streamradio-pomodoro-ring-point');
    point.setAttribute('r', '3.5');

    svg.appendChild(elapsedCircle);
    svg.appendChild(remainingCircle);
    svg.appendChild(point);
    dial.appendChild(svg);

    const content = dial.createDiv({ cls: 'streamradio-pomodoro-content' });
    content.createDiv({ cls: 'streamradio-pomodoro-phase', text: this.getPomodoroPhaseLabel(session.phase) });
    content.createDiv({ cls: 'streamradio-pomodoro-time', text: formatPomodoroTime(session.remainingSeconds) });
    this.renderPomodoroDots(content, session);
    this.renderPomodoroControls(content, session);
    this.updatePomodoroRing(wrapper, session);
  }

  private updatePomodoroRing(wrapper: HTMLElement, session: PomodoroSessionState): void {
    const progress = session.durationSeconds > 0 ? Math.max(0, Math.min(1, session.remainingSeconds / session.durationSeconds)) : 0;
    const pointAngle = (-90 + progress * 360) * Math.PI / 180;
    const pointX = 60 + 50 * Math.cos(pointAngle);
    const pointY = 60 + 50 * Math.sin(pointAngle);
    const remainingCircle = wrapper.querySelector<SVGCircleElement>('.streamradio-pomodoro-ring-remaining');
    const point = wrapper.querySelector<SVGCircleElement>('.streamradio-pomodoro-ring-point');

    if (remainingCircle) {
      remainingCircle.setAttribute('stroke-dasharray', `${progress * 100} 100`);
    }
    if (point) {
      point.setAttribute('cx', String(pointX));
      point.setAttribute('cy', String(pointY));
    }
  }

  private renderPomodoroDots(parent: HTMLElement, session: PomodoroSessionState): void {
    const dots = parent.createDiv({ cls: 'streamradio-pomodoro-dots', attr: { 'aria-label': `${session.completedIntervals} of ${this.plugin.settings.pomodoroIntervals} intervals complete` } });
    const longBreakEvery = this.plugin.settings.pomodoroLongBreakEvery;

    for (let index = 0; index < this.plugin.settings.pomodoroIntervals; index += 1) {
      const dot = dots.createSpan({ cls: 'streamradio-pomodoro-dot' });
      if (index < session.completedIntervals) {
        dot.addClass('is-complete');
      }
      if (index === session.currentIntervalIndex && session.completedIntervals < this.plugin.settings.pomodoroIntervals) {
        dot.addClass('is-active');
      }
      dot.setAttr('aria-hidden', 'true');

      if ((index + 1) % longBreakEvery === 0 && index < this.plugin.settings.pomodoroIntervals - 1) {
        dots.createSpan({ cls: 'streamradio-pomodoro-separator', attr: { 'aria-hidden': 'true' } });
      }
    }
  }

  private renderPomodoroControls(parent: HTMLElement, session: PomodoroSessionState): void {
    const controls = parent.createDiv({ cls: 'streamradio-pomodoro-controls' });

    const backButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': 'Restart current interval' } });
    setIcon(backButton, 'skip-back');
    backButton.addEventListener('click', () => {
      this.plugin.resetCurrentPomodoroInterval();
    });

    const playButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': session.isRunning ? 'Pause Pomodoro timer' : 'Start Pomodoro timer' } });
    setIcon(playButton, session.isRunning ? 'pause' : 'play');
    playButton.addEventListener('click', () => {
      this.plugin.togglePomodoro();
    });

    const nextButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': 'Next Pomodoro interval' } });
    setIcon(nextButton, 'skip-forward');
    nextButton.addEventListener('click', () => {
      this.plugin.skipToNextPomodoroInterval();
    });

    const resetButton = controls.createEl('button', { cls: 'clickable-icon streamradio-control-button', attr: { type: 'button', 'aria-label': 'Reset Pomodoro session' } });
    setIcon(resetButton, 'rotate-ccw');
    resetButton.addEventListener('click', () => {
      this.plugin.resetPomodoro();
    });
  }

  private applyPomodoroColors(wrapper: HTMLElement, phase: PomodoroPhase): void {
    wrapper.style.setProperty('--streamradio-pomodoro-ring-color', this.getPomodoroRingColor(phase));
    wrapper.style.setProperty('--streamradio-pomodoro-label-color', this.getPomodoroLabelColor(phase));
  }

  private applyPomodoroVisibility(wrapper: HTMLElement, session: PomodoroSessionState): void {
    const isHidden = this.plugin.getIsPomodoroHidden();
    wrapper.classList.toggle('is-hidden', isHidden);
    wrapper.setAttr('aria-hidden', String(isHidden));

    const opacity = this.plugin.getIsPomodoroDisplayDimmed(session)
      ? this.plugin.settings.pomodoroDimFactor / 100
      : 1;
    wrapper.style.setProperty('--streamradio-pomodoro-opacity', String(opacity));
  }

  private getPomodoroRingColor(phase: PomodoroPhase): string {
    if (phase === 'long-break') {
      return this.plugin.settings.pomodoroLongBreakColor;
    }

    if (phase === 'short-break') {
      return this.plugin.settings.pomodoroShortBreakColor;
    }

    return this.plugin.settings.pomodoroTimerColor;
  }

  private getPomodoroLabelColor(phase: PomodoroPhase): string {
    if (phase === 'long-break') {
      return this.plugin.settings.pomodoroLongBreakColor;
    }

    if (phase === 'short-break') {
      return this.plugin.settings.pomodoroShortBreakColor;
    }

    return this.plugin.settings.pomodoroTimerColor;
  }

  private getPomodoroPhaseLabel(phase: PomodoroPhase): string {
    if (phase === 'long-break') {
      return 'Long break';
    }

    if (phase === 'short-break') {
      return 'Short break';
    }

    return 'Focus';
  }
}

class ReleaseNotesModal extends Modal {
  private renderComponent = new Component();

  onOpen(): void {
    this.renderComponent.load();
    this.titleEl.setText('Release notes');
    this.contentEl.empty();
    this.contentEl.addClass('streamradio-release-notes');
    void MarkdownRenderer.render(this.app, releaseNotes, this.contentEl, '', this.renderComponent);
  }

  onClose(): void {
    this.renderComponent.unload();
    this.contentEl.empty();
  }
}

class StationSearchModal extends Modal {
  private filters: SearchFilters = { name: '', country: '', language: '', tag: '' };
  private selected = new Map<string, FavoriteStation>();
  private results: FavoriteStation[] = [];
  private page = 0;
  private hasNextPage = false;
  private totalPages = 1;
  private totalResults = 0;
  private countryDropdown: DropdownComponent | null = null;
  private languageDropdown: DropdownComponent | null = null;
  private tagDropdown: DropdownComponent | null = null;
  private resultsEl: HTMLElement | null = null;
  private paginationEl: HTMLElement | null = null;
  private previewAudio: HTMLAudioElement | null = null;
  private previewStationId = '';

  constructor(app: App, private plugin: StreamRadioPlugin, private onSaved: () => void) {
    super(app);
    for (const station of plugin.settings.favorites) {
      this.selected.set(station.stationuuid, station);
    }
  }

  onOpen(): void {
    this.titleEl.setText('Add favorite stations');
    this.contentEl.empty();
    this.contentEl.addClass('streamradio-search-modal');

    const searchRow = this.contentEl.createDiv({ cls: 'streamradio-search-row' });
    const nameSearch = new TextComponent(searchRow)
      .setPlaceholder('Station name')
      .onChange((value) => {
        this.filters.name = value;
      });
    nameSearch.inputEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      this.page = 0;
      void this.search();
    });

    const filterRow = this.contentEl.createDiv({ cls: 'streamradio-filter-row' });
    this.countryDropdown = new DropdownComponent(filterRow).addOption('', 'Any country');
    this.countryDropdown.onChange((value) => {
      this.filters.country = value;
    });

    this.languageDropdown = new DropdownComponent(filterRow).addOption('', 'Any language');
    this.languageDropdown.onChange((value) => {
      this.filters.language = value;
    });

    this.tagDropdown = new DropdownComponent(filterRow).addOption('', 'Any tag');
    this.tagDropdown.onChange((value) => {
      this.filters.tag = value;
    });

    const actionRow = this.contentEl.createDiv({ cls: 'streamradio-modal-actions' });
    new ButtonComponent(actionRow)
      .setButtonText('Search')
      .setCta()
      .onClick(() => {
        this.page = 0;
        void this.search();
      });

    const saveButton = new ButtonComponent(actionRow)
      .setButtonText('Save')
      .onClick(() => {
        void this.saveSelected();
      });
    saveButton.buttonEl.addClass('streamradio-save-button');

    this.resultsEl = this.contentEl.createDiv({ cls: 'streamradio-results' });
    this.paginationEl = this.contentEl.createDiv({ cls: 'streamradio-pagination' });
    this.resultsEl.createDiv({ cls: 'streamradio-empty-state', text: 'Search to add stations.' });

    void this.loadFacets();
  }

  onClose(): void {
    this.stopPreview();
    this.contentEl.empty();
  }

  private async loadFacets(): Promise<void> {
    try {
      const [countries, languages, tags] = await Promise.all([
        fetchRadioBrowser<RadioBrowserFacet[]>('/countries'),
        fetchRadioBrowser<RadioBrowserFacet[]>('/languages'),
        fetchRadioBrowser<RadioBrowserFacet[]>('/tags'),
      ]);

      this.populateDropdown(this.countryDropdown, countries, 'Any country');
      this.populateDropdown(this.languageDropdown, languages, 'Any language');
      this.populateDropdown(this.tagDropdown, tags, 'Any tag');
    } catch (error) {
      new Notice('StreamRadio could not load search filters.');
    }
  }

  private populateDropdown(dropdown: DropdownComponent | null, facets: RadioBrowserFacet[], emptyLabel: string): void {
    if (!dropdown) {
      return;
    }

    dropdown.selectEl.empty();
    dropdown.addOption('', emptyLabel);
    facets
      .map((facet) => ({ name: normalizeFacetName(facet.name), count: facet.stationcount || 0 }))
      .filter((facet) => facet.name)
      .sort((left, right) => right.count - left.count)
      .forEach((facet) => dropdown.addOption(facet.name, facet.name));
  }

  private async search(): Promise<void> {
    if (!this.resultsEl) {
      return;
    }

    this.stopPreview();
    this.resultsEl.empty();
    this.resultsEl.createDiv({ cls: 'streamradio-empty-state', text: 'Searching...' });

    try {
      const pageQuery = this.createSearchQuery(SEARCH_PAGE_SIZE + 1, this.page * SEARCH_PAGE_SIZE);
      const countQuery = this.createSearchQuery(SEARCH_COUNT_LIMIT, 0);
      const [stations, countStations] = await Promise.all([
        fetchRadioBrowser<RadioBrowserStation[]>(`/stations/search?${pageQuery.toString()}`),
        fetchRadioBrowser<RadioBrowserStation[]>(`/stations/search?${countQuery.toString()}`),
      ]);
      const playableStations = stations.map(toFavoriteStation).filter((station) => station.streamUrl);
      const totalResults = countStations.filter((station) => station.url_resolved || station.url).length;
      this.hasNextPage = playableStations.length > SEARCH_PAGE_SIZE;
      this.totalResults = totalResults;
      this.totalPages = Math.max(1, Math.ceil(totalResults / SEARCH_PAGE_SIZE));
      this.results = playableStations.slice(0, SEARCH_PAGE_SIZE);
      this.renderResults();
    } catch (error) {
      this.resultsEl.empty();
      this.resultsEl.createDiv({ cls: 'streamradio-empty-state', text: 'Search failed. Try again later.' });
    }
  }

  private createSearchQuery(limit: number, offset: number): URLSearchParams {
    const query = new URLSearchParams();
    query.set('hidebroken', 'true');
    query.set('order', 'clickcount');
    query.set('reverse', 'true');
    query.set('limit', String(limit));
    query.set('offset', String(offset));

    if (this.filters.name.trim()) {
      query.set('name', this.filters.name.trim());
    }
    if (this.filters.country) {
      query.set('country', this.filters.country);
    }
    if (this.filters.language) {
      query.set('language', this.filters.language);
    }
    if (this.filters.tag) {
      query.set('tag', this.filters.tag);
    }

    return query;
  }

  private renderResults(): void {
    if (!this.resultsEl || !this.paginationEl) {
      return;
    }

    this.resultsEl.empty();

    if (this.results.length === 0) {
      this.resultsEl.createDiv({ cls: 'streamradio-empty-state', text: 'No stations found.' });
    }

    for (const station of this.results) {
      const row = this.resultsEl.createDiv({ cls: 'streamradio-result-row' });
      this.createStationLogo(row, station);

      const text = row.createDiv({ cls: 'streamradio-result-text' });
      text.createDiv({ cls: 'streamradio-station-name', text: station.name });
      text.createDiv({ cls: 'streamradio-station-meta', text: `${stationFormat(station)} · ${bitrateLabel(station.bitrate)}` });

      const controls = row.createDiv({ cls: 'streamradio-row-actions' });
      const checkbox = controls.createEl('input', {
        attr: {
          type: 'checkbox',
          'aria-label': `Select ${station.name}`,
        },
      });
      checkbox.checked = this.selected.has(station.stationuuid);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selected.set(station.stationuuid, station);
        } else {
          this.selected.delete(station.stationuuid);
        }
      });

      const previewButton = controls.createEl('button', { cls: 'clickable-icon streamradio-icon-button', attr: { type: 'button', 'aria-label': `Preview ${station.name}` } });
      setIcon(previewButton, this.previewStationId === station.stationuuid ? 'square' : 'play');
      previewButton.addEventListener('click', () => {
        void this.togglePreview(station);
      });
    }

    this.renderPagination();
  }

  private renderPagination(): void {
    if (!this.paginationEl) {
      return;
    }

    this.paginationEl.empty();
    const previous = this.paginationEl.createEl('button', { cls: 'clickable-icon streamradio-icon-button', attr: { type: 'button', 'aria-label': 'Previous page' } });
    setIcon(previous, 'chevron-left');
    previous.disabled = this.page === 0;
    previous.addEventListener('click', () => {
      if (this.page > 0) {
        this.page -= 1;
        void this.search();
      }
    });

    this.paginationEl.createSpan({ cls: 'streamradio-page-label', text: `Page ${this.page + 1} of ${this.totalPages} · ${this.totalResults} stations` });

    const next = this.paginationEl.createEl('button', { cls: 'clickable-icon streamradio-icon-button', attr: { type: 'button', 'aria-label': 'Next page' } });
    setIcon(next, 'chevron-right');
    next.disabled = !this.hasNextPage;
    next.addEventListener('click', () => {
      if (this.hasNextPage) {
        this.page += 1;
        void this.search();
      }
    });
  }

  private async togglePreview(station: FavoriteStation): Promise<void> {
    if (this.previewStationId === station.stationuuid) {
      this.stopPreview();
      this.renderResults();
      return;
    }

    this.stopPreview();
    const audio = new Audio(station.streamUrl);
    audio.preload = 'none';
    audio.addEventListener('error', () => {
      if (this.previewAudio === audio) {
        this.stopPreview();
        this.renderResults();
        new Notice(`Could not preview ${station.name}.`);
      }
    });
    this.previewAudio = audio;
    this.previewStationId = station.stationuuid;
    this.renderResults();

    try {
      await audio.play();
    } catch (error) {
      this.stopPreview();
      this.renderResults();
      new Notice(`Could not preview ${station.name}.`);
    }
  }

  private stopPreview(): void {
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.removeAttribute('src');
      this.previewAudio.load();
    }

    this.previewAudio = null;
    this.previewStationId = '';
  }

  private async saveSelected(): Promise<void> {
    const favorites = Array.from(this.selected.values());
    await this.plugin.saveFavorites(favorites);
    this.onSaved();
    this.close();
  }

  private createStationLogo(parent: HTMLElement, station: FavoriteStation): void {
    if (!station.favicon) {
      const fallback = parent.createDiv({ cls: 'streamradio-logo-fallback' });
      setIcon(fallback, 'radio');
      return;
    }

    parent.createEl('img', {
      cls: 'streamradio-station-logo',
      attr: {
        src: station.favicon,
        alt: '',
        loading: 'lazy',
      },
    });
  }
}

class StationPickerModal extends Modal {
  constructor(app: App, private plugin: StreamRadioPlugin) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Select station');
    this.contentEl.empty();
    this.contentEl.addClass('streamradio-picker-modal');

    if (this.plugin.settings.favorites.length === 0) {
      this.contentEl.createDiv({ cls: 'streamradio-empty-state', text: 'No favorite stations yet.' });
      return;
    }

    for (const station of this.plugin.settings.favorites) {
      const button = this.contentEl.createEl('button', { cls: 'streamradio-picker-row', attr: { type: 'button' } });
      if (station.favicon) {
        button.createEl('img', { cls: 'streamradio-station-logo', attr: { src: station.favicon, alt: '' } });
      } else {
        const fallback = button.createDiv({ cls: 'streamradio-logo-fallback' });
        setIcon(fallback, 'radio');
      }

      const text = button.createDiv({ cls: 'streamradio-result-text' });
      text.createDiv({ cls: 'streamradio-station-name', text: station.name });
      text.createDiv({ cls: 'streamradio-station-meta', text: `${stationFormat(station)} · ${bitrateLabel(station.bitrate)}` });

      button.addEventListener('click', () => {
        this.close();
        void this.plugin.playStation(station);
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class SleepTimerModal extends Modal {
  private selectedMinutes = 15;
  private customInput: TextComponent | null = null;

  constructor(app: App, private plugin: StreamRadioPlugin) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Sleep timer');
    this.contentEl.empty();
    this.contentEl.addClass('streamradio-timer-modal');

    const options = [5, 10, 15, 30, 45, 60, 120];
    const optionGroup = this.contentEl.createDiv({ cls: 'streamradio-timer-options' });

    for (const minutes of options) {
      const label = optionGroup.createEl('label', { cls: 'streamradio-radio-option' });
      const input = label.createEl('input', { attr: { type: 'radio', name: 'streamradio-timer', value: String(minutes) } });
      input.checked = minutes === this.selectedMinutes;
      input.addEventListener('change', () => {
        this.selectedMinutes = minutes;
      });
      label.createSpan({ text: `${minutes} min` });
    }

    const customLabel = optionGroup.createEl('label', { cls: 'streamradio-radio-option streamradio-custom-timer' });
    const customRadio = customLabel.createEl('input', { attr: { type: 'radio', name: 'streamradio-timer', value: 'custom' } });
    customLabel.createSpan({ text: 'Custom' });
    this.customInput = new TextComponent(customLabel).setPlaceholder('Minutes');
    this.customInput.inputEl.setAttr('inputmode', 'numeric');
    this.customInput.onChange((value) => {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        this.selectedMinutes = parsed;
        customRadio.checked = true;
      }
    });
    customRadio.addEventListener('change', () => {
      const parsed = Number(this.customInput?.getValue() || '');
      if (Number.isFinite(parsed) && parsed > 0) {
        this.selectedMinutes = parsed;
      }
    });

    const actions = this.contentEl.createDiv({ cls: 'streamradio-modal-actions' });
    new ButtonComponent(actions)
      .setButtonText('Start timer')
      .setCta()
      .onClick(() => {
        this.plugin.startSleepTimer(this.selectedMinutes);
        this.close();
      });

    new ButtonComponent(actions)
      .setButtonText('Clear timer')
      .onClick(() => {
        this.plugin.clearSleepTimer();
        this.close();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

async function fetchRadioBrowser<T>(path: string): Promise<T> {
  const response = await requestUrl({
    url: `${RADIO_BROWSER_BASE_URL}${path}`,
    method: 'GET',
    headers: {
      'User-Agent': 'StreamRadio/1.1.0',
    },
  });

  return response.json as T;
}