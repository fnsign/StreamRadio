import { Notice, Plugin } from 'obsidian';
import {
  POMODORO_DIM_DELAY_SECONDS,
  POMODORO_REFRESH_INTERVAL_MS,
  POMODORO_RESTORE_BEFORE_END_SECONDS,
  POMODORO_WARNING_COUNTDOWN_SECONDS,
  TIMER_REFRESH_INTERVAL_MS,
  VIEW_TYPE_STREAMRADIO,
} from './constants';
import { getThemeAccentColor } from './colorUtils';
import { IcyMetadataService } from './icyMetadataService';
import { DEFAULT_SETTINGS, clampInteger, clampPercentage, clampVolume, normalizeSettings } from './settings';
import { secondsFromMinutes } from './pomodoroUtils';
import type { AppWithSettings, FavoriteStation, IcyTrackMetadata, PomodoroPhase, PomodoroSessionState, StationLogoOptions, StreamRadioSettings } from './types';
import { fetchRadioBrowserStationsByUuid } from './radioBrowserApi';
import { StreamRadioPlayerView } from './ui/StreamRadioPlayerView';
import { StreamRadioSettingTab } from './ui/StreamRadioSettingTab';
import { StationLogoResolver, createStationLogo } from './ui/stationLogo';

const FAVORITE_DETAIL_REFRESH_BATCH_SIZE = 8;

export default class StreamRadioPlugin extends Plugin {
  settings: StreamRadioSettings = DEFAULT_SETTINGS;
  private settingTab: StreamRadioSettingTab | null = null;
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
  private pomodoroAutoDimSuppressed = false;
  private stationLogoResolver = new StationLogoResolver();
  private volumeFadeIntervalId: number | null = null;
  private volumeFadeMultiplier = 1;
  private volumeFadeToken = 0;
  private isPomodoroVolumeDucked = false;
  private isRefreshingFavoriteStationDetails = false;
  private currentMetadata: IcyTrackMetadata = { title: '', artist: '' };
  private icyMetadataService = new IcyMetadataService((metadata) => {
    this.currentMetadata = metadata;
    this.refreshPlayerMetadataViews();
  });

  async onload(): Promise<void> {
    await this.loadSettings();
    void this.refreshFavoriteStationDetails();

    this.registerView(VIEW_TYPE_STREAMRADIO, (leaf) => new StreamRadioPlayerView(leaf, this));

    this.addRibbonIcon('radio', 'Open StreamRadio', () => {
      void this.activatePlayerView();
    });

    this.addCommand({
      id: 'open-player',
      name: 'Open player',
      callback: () => {
        void this.activatePlayerView();
      },
    });

    this.settingTab = new StreamRadioSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  onunload(): void {
    this.icyMetadataService.stop();
    this.stopPlayback();
    this.clearSleepTimer(false);
    this.clearPomodoroTimer();
    this.clearPomodoroBeeps();
    this.clearVolumeFade();
    void this.beepAudioContext?.close();
  }

  async loadSettings(): Promise<void> {
    const loadedSettings = await this.loadData() as Partial<StreamRadioSettings> | null;
    this.settings = normalizeSettings(loadedSettings, getThemeAccentColor());
  }

  async saveSettings(refresh = true): Promise<void> {
    if (!this.settings.favorites.some((station) => station.stationuuid === this.settings.activeStationId)) {
      this.settings.activeStationId = this.settings.favorites[0]?.stationuuid || '';
    }

    this.settings.pomodoroIntervals = clampInteger(this.settings.pomodoroIntervals, DEFAULT_SETTINGS.pomodoroIntervals, 1, 8);
    this.settings.pomodoroLongBreakEvery = clampInteger(this.settings.pomodoroLongBreakEvery, DEFAULT_SETTINGS.pomodoroLongBreakEvery, 1, 8);
    this.settings.pomodoroDimFactor = clampPercentage(this.settings.pomodoroDimFactor, DEFAULT_SETTINGS.pomodoroDimFactor);
    this.syncPomodoroSessionWithSettings();

    if (!this.settings.pomodoroEnabled) {
      this.settings.pomodoroHidden = false;
      this.resetPomodoro(false);
    }

    await this.saveData(this.settings);
    if (refresh) {
      this.refreshPlayerViews();
    }
  }

  getCurrentStation(): FavoriteStation | null {
    return this.settings.favorites.find((station) => station.stationuuid === this.settings.activeStationId)
      || this.settings.favorites[0]
      || null;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getMetadataLabel(): string {
    return [this.currentMetadata.title, this.currentMetadata.artist].filter(Boolean).join(' / ');
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

  getDisplayedVolume(): number {
    return this.settings.muted ? 0 : this.getVolume();
  }

  getIsMuted(): boolean {
    return this.settings.muted;
  }

  getVolumeIconName(): string {
    if (this.settings.muted || this.getDisplayedVolume() === 0) {
      return 'volume-x';
    }

    return this.getVolume() <= 0.5 ? 'volume-1' : 'volume-2';
  }

  async setVolume(volume: number, persist = false): Promise<void> {
    const nextVolume = clampVolume(volume);
    const previousVolume = this.settings.volume;
    const previousMuted = this.settings.muted;
    const previousLastVolume = this.settings.lastVolume;

    if (nextVolume <= 0) {
      if (this.settings.volume > 0) {
        this.settings.lastVolume = this.settings.volume;
      }
      this.settings.muted = true;
    } else {
      this.settings.volume = nextVolume;
      this.settings.lastVolume = nextVolume;
      this.settings.muted = false;
    }

    const didChange = previousVolume !== this.settings.volume || previousMuted !== this.settings.muted || previousLastVolume !== this.settings.lastVolume;
    if (!didChange) {
      return;
    }

    this.applyAudioVolume();

    if (previousMuted !== this.settings.muted) {
      this.refreshPlayerViews();
    }

    if (persist) {
      await this.saveSettings(false);
    }
  }

  async toggleMute(persist = true): Promise<void> {
    if (this.settings.muted) {
      const restoredVolume = clampVolume(this.settings.lastVolume || this.settings.volume || DEFAULT_SETTINGS.lastVolume);
      this.settings.volume = restoredVolume > 0 ? restoredVolume : DEFAULT_SETTINGS.lastVolume;
      this.settings.lastVolume = this.settings.volume;
      this.settings.muted = false;
    } else {
      if (this.settings.volume > 0) {
        this.settings.lastVolume = this.settings.volume;
      }
      this.settings.muted = true;
    }

    this.applyAudioVolume();
    this.refreshPlayerViews();

    if (persist) {
      await this.saveSettings(false);
    }
  }

  openSettingsTab(): void {
    this.openPluginSettingsTab();
  }

  openStationSearchSettings(): void {
    if (!this.openPluginSettingsTab()) {
      return;
    }

    this.settingTab?.openStationSearch();
  }

  private openPluginSettingsTab(): boolean {
    const settingsWindow = (this.app as AppWithSettings).setting;
    if (!settingsWindow) {
      new Notice('StreamRadio could not open plugin settings.');
      return false;
    }

    settingsWindow.open();
    settingsWindow.openTabById(this.manifest.id);
    return true;
  }

  getIsPomodoroHidden(): boolean {
    return this.settings.pomodoroHidden;
  }

  togglePomodoroVisibility(): void {
    this.settings.pomodoroHidden = !this.settings.pomodoroHidden;
    this.refreshPomodoroViews();
    void this.saveSettings(false);
  }

  getIsPomodoroDisplayDimmed(session = this.getPomodoroSession()): boolean {
    return this.settings.pomodoroManualDimEnabled || (this.shouldAutoDimPomodoro(session) && !this.pomodoroAutoDimSuppressed);
  }

  togglePomodoroDisplayDim(): void {
    const session = this.getPomodoroSession();
    const isAutoDimmed = this.shouldAutoDimPomodoro(session);
    const isDisplayDimmed = this.getIsPomodoroDisplayDimmed(session);

    if (isDisplayDimmed) {
      this.settings.pomodoroManualDimEnabled = false;
      this.pomodoroAutoDimSuppressed = isAutoDimmed;
    } else if (isAutoDimmed) {
      this.pomodoroAutoDimSuppressed = false;
    } else {
      this.settings.pomodoroManualDimEnabled = true;
      this.pomodoroAutoDimSuppressed = false;
    }

    this.refreshPomodoroViews();
    void this.saveSettings(false);
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
      this.app.workspace.setActiveLeaf(existingLeaves[0], { focus: true });
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice('StreamRadio could not open the right sidebar.');
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE_STREAMRADIO, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
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

    if (shouldContinuePlayback) {
      await this.playStation(station);
      return;
    }

    this.settings.activeStationId = station.stationuuid;
    await this.saveSettings(false);

    this.refreshPlayerViews();
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

    const stationChanged = this.settings.activeStationId !== station.stationuuid;
    this.stopAudioElement();
    this.icyMetadataService.stop();
    this.settings.activeStationId = station.stationuuid;
    if (stationChanged) {
      this.refreshPlayerPlaybackViews();
    }

    const audio = new Audio(station.streamUrl);
    audio.preload = 'none';
    audio.volume = this.getEffectiveVolume();
    audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.icyMetadataService.stop();
      this.refreshPlayerPlaybackViews();
    });
    audio.addEventListener('pause', () => {
      if (this.audio === audio && !audio.ended) {
        this.isPlaying = false;
        this.icyMetadataService.stop();
        this.refreshPlayerPlaybackViews();
      }
    });
    audio.addEventListener('playing', () => {
      if (this.audio === audio) {
        this.isPlaying = true;
        this.refreshPlayerPlaybackViews();
      }
    });
    audio.addEventListener('error', () => {
      if (this.audio === audio) {
        this.isPlaying = false;
        this.icyMetadataService.stop();
        this.refreshPlayerPlaybackViews();
        new Notice(`Could not play ${station.name}.`);
      }
    });

    this.audio = audio;

    try {
      await audio.play();
      this.isPlaying = true;
      this.icyMetadataService.start(station.streamUrl);
      await this.saveSettings(false);
      this.refreshPlayerPlaybackViews();
    } catch {
      this.isPlaying = false;
      this.icyMetadataService.stop();
      this.refreshPlayerPlaybackViews();
      new Notice(`Could not start ${station.name}.`);
    }
  }

  pausePlayback(): void {
    if (this.audio) {
      this.audio.pause();
    }

    this.icyMetadataService.stop();
    this.isPlaying = false;
    this.refreshPlayerPlaybackViews();
  }

  stopPlayback(): void {
    this.cancelPomodoroVolumeDuck(false);
    this.icyMetadataService.stop();
    this.stopAudioElement();
    this.isPlaying = false;
    this.refreshPlayerPlaybackViews();
  }

  startSleepTimer(minutes: number): void {
    this.clearSleepTimer(false);

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

  clearSleepTimer(refresh = true): void {
    if (this.sleepTimerId !== null) {
      window.clearTimeout(this.sleepTimerId);
    }
    if (this.sleepTimerRefreshId !== null) {
      window.clearInterval(this.sleepTimerRefreshId);
    }

    this.sleepTimerId = null;
    this.sleepTimerRefreshId = null;
    this.sleepTimerEndsAt = 0;
    if (refresh) {
      this.refreshPlayerViews();
    }
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
      this.cancelPomodoroVolumeDuck();
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
    this.cancelPomodoroVolumeDuck();

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
    this.cancelPomodoroVolumeDuck(false);
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

  async removeFavorite(stationUuid: string): Promise<void> {
    const stationToRemove = this.settings.favorites.find((station) => station.stationuuid === stationUuid) || null;
    const wasActiveStation = this.settings.activeStationId === stationUuid;
    const wasPlayingRemovedStation = this.isPlaying && !!stationToRemove && this.getCurrentStation()?.stationuuid === stationUuid;
    const favorites = this.settings.favorites.filter((station) => station.stationuuid !== stationUuid);

    if (favorites.length === this.settings.favorites.length) {
      return;
    }

    if (wasPlayingRemovedStation) {
      this.stopPlayback();
    }

    this.settings.favorites = favorites;

    if (wasActiveStation) {
      this.settings.activeStationId = favorites[0]?.stationuuid || '';
    }

    await this.saveSettings();
  }

  private async refreshFavoriteStationDetails(): Promise<void> {
    if (this.isRefreshingFavoriteStationDetails) {
      return;
    }

    const favoritesToRefresh = this.settings.favorites.filter((station) => !station.homepage.trim() || !station.favicon.trim());
    if (favoritesToRefresh.length === 0) {
      return;
    }

    this.isRefreshingFavoriteStationDetails = true;
    try {
      const updatedStations: FavoriteStation[] = [];
      for (let index = 0; index < favoritesToRefresh.length; index += FAVORITE_DETAIL_REFRESH_BATCH_SIZE) {
        const batch = favoritesToRefresh.slice(index, index + FAVORITE_DETAIL_REFRESH_BATCH_SIZE);
        updatedStations.push(...await fetchRadioBrowserStationsByUuid(batch.map((station) => station.stationuuid)));
      }
      const updatedStationsById = new Map(updatedStations.map((station) => [station.stationuuid, station]));
      let didUpdate = false;
      const favorites = this.settings.favorites.map((station) => {
        const updatedStation = updatedStationsById.get(station.stationuuid);
        if (!updatedStation) {
          return station;
        }

        const homepage = station.homepage || updatedStation.homepage;
        const favicon = station.favicon || updatedStation.favicon;
        if (homepage === station.homepage && favicon === station.favicon) {
          return station;
        }

        didUpdate = true;
        return { ...station, homepage, favicon };
      });

      if (didUpdate) {
        this.settings.favorites = favorites;
        await this.saveSettings();
      }
    } finally {
      this.isRefreshingFavoriteStationDetails = false;
    }
  }

  refreshPlayerViews(): void {
    this.forEachPlayerView((view) => view.render());
  }

  refreshPomodoroViews(): void {
    this.refreshPomodoroDisplays();
  }

  refreshPlayerPlaybackViews(): void {
    this.forEachPlayerView((view) => view.updatePlaybackDisplay());
  }

  refreshPlayerMetadataViews(): void {
    this.forEachPlayerView((view) => view.updateMetadataDisplay());
  }

  refreshPomodoroDisplays(): void {
    this.forEachPlayerView((view) => view.updatePomodoroDisplay());
  }

  private forEachPlayerView(callback: (view: StreamRadioPlayerView) => void): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAMRADIO)) {
      if (leaf.view instanceof StreamRadioPlayerView) {
        callback(leaf.view);
      }
    }
  }

  createStationLogo(parent: HTMLElement, station: Pick<FavoriteStation, 'favicon' | 'name'>, options: StationLogoOptions): HTMLElement {
    return createStationLogo(parent, station, options, this.stationLogoResolver);
  }

  private stopAudioElement(): void {
    if (!this.audio) {
      return;
    }

    const audio = this.audio;
    this.audio = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
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

    if (session.remainingSeconds <= POMODORO_WARNING_COUNTDOWN_SECONDS && session.remainingSeconds > 0 && this.pomodoroBreakWarningSecond !== session.remainingSeconds) {
      this.pomodoroBreakWarningSecond = session.remainingSeconds;
      if (session.remainingSeconds === POMODORO_WARNING_COUNTDOWN_SECONDS) {
        this.beginPomodoroVolumeDuck();
      }
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

    this.playPomodoroCompletionBeeps();
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
    this.cancelPomodoroVolumeDuck();
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

  private syncPomodoroSessionWithSettings(): void {
    if (!this.pomodoroSession) {
      return;
    }

    const session = this.pomodoroSession;
    const durationSeconds = this.getPomodoroPhaseDurationSeconds(session.phase);
    const elapsedSeconds = Math.max(0, session.durationSeconds - session.remainingSeconds);
    session.durationSeconds = durationSeconds;

    if (session.remainingSeconds > 0) {
      session.remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);
    }
  }

  private playPomodoroCompletionBeeps(): void {
    this.clearPomodoroBeeps();
    this.holdPomodoroVolumeDuck();
    [0, 250, 500].forEach((delay) => {
      const timeoutId = window.setTimeout(() => {
        this.playBeep();
      }, delay);
      this.pomodoroBeepTimeoutIds.push(timeoutId);
    });

    const restoreId = window.setTimeout(() => {
      this.cancelPomodoroVolumeDuck();
    }, 700);
    this.pomodoroBeepTimeoutIds.push(restoreId);
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
    gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.01);
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

  private getEffectiveVolume(): number {
    if (this.settings.muted) {
      return 0;
    }

    return clampVolume(this.settings.volume * this.volumeFadeMultiplier);
  }

  private applyAudioVolume(): void {
    if (this.audio) {
      this.audio.volume = this.getEffectiveVolume();
    }
  }

  private beginPomodoroVolumeDuck(): void {
    this.isPomodoroVolumeDucked = true;
    this.startVolumeFade(0.15, 5000);
  }

  private holdPomodoroVolumeDuck(): void {
    this.isPomodoroVolumeDucked = true;
    this.startVolumeFade(0.15, 0);
  }

  private cancelPomodoroVolumeDuck(animated = true): void {
    if (!this.isPomodoroVolumeDucked && this.volumeFadeMultiplier === 1) {
      return;
    }

    this.isPomodoroVolumeDucked = false;
    this.startVolumeFade(1, animated ? 1000 : 0);
  }

  private startVolumeFade(targetMultiplier: number, durationMs: number): void {
    this.volumeFadeToken += 1;
    const token = this.volumeFadeToken;
    this.clearVolumeFade();

    const startMultiplier = this.volumeFadeMultiplier;
    if (durationMs <= 0 || Math.abs(startMultiplier - targetMultiplier) < 0.001) {
      this.volumeFadeMultiplier = targetMultiplier;
      this.applyAudioVolume();
      return;
    }

    const startedAt = Date.now();
    this.volumeFadeIntervalId = window.setInterval(() => {
      if (token !== this.volumeFadeToken) {
        this.clearVolumeFade();
        return;
      }

      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      this.volumeFadeMultiplier = startMultiplier + (targetMultiplier - startMultiplier) * progress;
      this.applyAudioVolume();

      if (progress >= 1) {
        this.clearVolumeFade();
      }
    }, 50);
  }

  private clearVolumeFade(): void {
    if (this.volumeFadeIntervalId !== null) {
      window.clearInterval(this.volumeFadeIntervalId);
    }

    this.volumeFadeIntervalId = null;
  }
}
