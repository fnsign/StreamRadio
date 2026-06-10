import { ItemView, setIcon, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_STREAMRADIO } from '../constants';
import { formatPomodoroTime } from '../pomodoroUtils';
import { bitrateLabel, stationFormat } from '../stationUtils';
import type { FavoriteStation, PomodoroPhase, PomodoroSessionState } from '../types';
import type { StreamRadioPluginApi } from './pluginTypes';
import { SleepTimerModal } from './SleepTimerModal';
import { StationPickerModal } from './StationPickerModal';

export class StreamRadioPlayerView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: StreamRadioPluginApi) {
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
    const volumeButton = volumeControl.createEl('button', {
      cls: `clickable-icon streamradio-volume-icon-button${this.plugin.getIsMuted() ? ' is-muted' : ''}`,
      attr: {
        type: 'button',
        'aria-label': this.plugin.getIsMuted() ? 'Unmute stream' : 'Mute stream',
        'aria-pressed': String(this.plugin.getIsMuted()),
      },
    });
    setIcon(volumeButton, this.plugin.getVolumeIconName());
    volumeButton.addEventListener('click', () => {
      void this.plugin.toggleMute();
    });

    const volumeSlider = volumeControl.createEl('input', {
      attr: {
        type: 'range',
        min: '0',
        max: '1',
        step: '0.01',
        value: String(this.plugin.getDisplayedVolume()),
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
    const wrapper = this.plugin.createStationLogo(parent, station, {
      wrapperClass: 'streamradio-player-logo-slot streamradio-station-info-anchor',
      imageClass: 'streamradio-player-logo',
      fallbackClass: 'streamradio-player-logo streamradio-logo-fallback',
      loading: 'eager',
    });
    wrapper.setAttr('tabindex', '0');

    const popover = wrapper.createDiv({ cls: 'streamradio-station-info-popover' });
    const infoRows = [
      ['Country', station.country || 'Unknown'],
      ['Language', station.language || 'Unknown'],
      ['Format', stationFormat(station)],
      ['Bitrate', bitrateLabel(station.bitrate)],
    ];

    infoRows.forEach(([label, value]) => {
      const row = popover.createDiv({ cls: 'streamradio-station-info-row' });
      row.createSpan({ cls: 'streamradio-station-info-label', text: `${label}:` });
      row.createSpan({ cls: 'streamradio-station-info-value', text: value });
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
    const svgDocument = container.ownerDocument;
    const svg = svgDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'streamradio-pomodoro-ring');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('aria-hidden', 'true');

    const elapsedCircle = svgDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
    elapsedCircle.setAttribute('class', 'streamradio-pomodoro-ring-elapsed');
    elapsedCircle.setAttribute('cx', '60');
    elapsedCircle.setAttribute('cy', '60');
    elapsedCircle.setAttribute('r', '50');

    const remainingCircle = svgDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
    remainingCircle.setAttribute('class', 'streamradio-pomodoro-ring-remaining');
    remainingCircle.setAttribute('cx', '60');
    remainingCircle.setAttribute('cy', '60');
    remainingCircle.setAttribute('r', '50');
    remainingCircle.setAttribute('pathLength', '100');

    const point = svgDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
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
        if (session.phase === 'focus' && session.isRunning) {
          dot.addClass('is-pulsing');
        }
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
