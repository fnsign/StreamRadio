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
const MAX_FAVORITES = 16;
const SEARCH_PAGE_SIZE = 20;
const SEARCH_COUNT_LIMIT = 100000;
const TIMER_REFRESH_INTERVAL_MS = 30000;
const MAX_VISIBLE_TAGS = 6;

interface StreamRadioSettings {
  showStationLogos: boolean;
  favorites: FavoriteStation[];
  activeStationId: string;
  volume: number;
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

export default class StreamRadioPlugin extends Plugin {
  settings: StreamRadioSettings = DEFAULT_SETTINGS;
  private audio: HTMLAudioElement | null = null;
  private isPlaying = false;
  private sleepTimerId: number | null = null;
  private sleepTimerRefreshId: number | null = null;
  private sleepTimerEndsAt = 0;

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
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.favorites = this.settings.favorites
      .filter((station) => station.stationuuid && station.streamUrl)
      .slice(0, MAX_FAVORITES);
    this.settings.volume = clampVolume(this.settings.volume ?? DEFAULT_SETTINGS.volume);
  }

  async saveSettings(): Promise<void> {
    this.settings.favorites = this.settings.favorites.slice(0, MAX_FAVORITES);
    if (!this.settings.favorites.some((station) => station.stationuuid === this.settings.activeStationId)) {
      this.settings.activeStationId = this.settings.favorites[0]?.stationuuid || '';
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

  async saveFavorites(favorites: FavoriteStation[]): Promise<void> {
    this.settings.favorites = favorites.slice(0, MAX_FAVORITES);
    await this.saveSettings();
  }

  refreshPlayerViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAMRADIO)) {
      if (leaf.view instanceof StreamRadioPlayerView) {
        leaf.view.render();
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
}

class StreamRadioSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: StreamRadioPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

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
      .setDesc(`Add and arrange up to ${MAX_FAVORITES} favorite stations.`)
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

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('streamradio-player');

    const station = this.plugin.getCurrentStation();
    if (!station) {
      container.createDiv({ cls: 'streamradio-empty-state', text: 'Add favorite stations in StreamRadio settings.' });
      this.renderSelectionButton(container);
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

    const timerLabel = this.plugin.getSleepTimerLabel();
    if (timerLabel) {
      container.createDiv({ cls: 'streamradio-timer-label', text: timerLabel });
    }
  }

  private renderSelectionButton(container: HTMLElement): void {
    const button = container.createEl('button', { cls: 'mod-cta streamradio-wide-button', text: 'Select station', attr: { type: 'button' } });
    button.addEventListener('click', () => new StationPickerModal(this.app, this.plugin).open());
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
    new TextComponent(searchRow)
      .setPlaceholder('Station name')
      .onChange((value) => {
        this.filters.name = value;
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

    new ButtonComponent(actionRow)
      .setButtonText('Save')
      .onClick(() => {
        void this.saveSelected();
      });

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
          if (!this.selected.has(station.stationuuid) && this.selected.size >= MAX_FAVORITES) {
            checkbox.checked = false;
            new Notice(`StreamRadio can save up to ${MAX_FAVORITES} favorites.`);
            return;
          }
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
    const favorites = Array.from(this.selected.values()).slice(0, MAX_FAVORITES);
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
      'User-Agent': 'StreamRadio/0.1.0',
    },
  });

  return response.json as T;
}