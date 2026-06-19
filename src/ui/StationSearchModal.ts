import { App, ButtonComponent, DropdownComponent, Modal, Notice, TextComponent, setIcon } from 'obsidian';
import { fetchRadioBrowserFacets, fetchRadioBrowserServerStats, searchRadioBrowserStations } from '../radioBrowserApi';
import { bitrateLabel, normalizeFacetName, stationFormat } from '../stationUtils';
import type { FavoriteStation, RadioBrowserFacet, SearchFilters } from '../types';
import type { StreamRadioPluginApi } from './pluginTypes';

interface CustomStationDraft {
  name: string;
  streamUrl: string;
  favicon: string;
  homepage: string;
}

export class StationSearchModal extends Modal {
  private filters: SearchFilters = { name: '', country: '', language: '', tag: '' };
  private activeFilters: SearchFilters = { name: '', country: '', language: '', tag: '' };
  private selected = new Map<string, FavoriteStation>();
  private results: FavoriteStation[] = [];
  private resultsById = new Map<string, FavoriteStation>();
  private page = 0;
  private hasNextPage = false;
  private totalPages = 1;
  private totalResults = 0;
  private searchTotalsKnown = false;
  private countryDropdown: DropdownComponent | null = null;
  private languageDropdown: DropdownComponent | null = null;
  private tagDropdown: DropdownComponent | null = null;
  private serverStatusEl: HTMLElement | null = null;
  private serverStationsCount = 0;
  private resultsEl: HTMLElement | null = null;
  private paginationEl: HTMLElement | null = null;
  private previewAudio: HTMLAudioElement | null = null;
  private previewStationId = '';
  private shouldResumePlaybackOnClose = false;
  private searchRequestId = 0;

  constructor(app: App, private plugin: StreamRadioPluginApi, private onSaved: () => void) {
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
      this.activeFilters = { ...this.filters };
      this.searchTotalsKnown = false;
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
    this.serverStatusEl = actionRow.createDiv({ cls: 'streamradio-server-status' });
    this.renderServerStatus('hidden');

    new ButtonComponent(actionRow)
      .setButtonText('Search')
      .setCta()
      .onClick(() => {
        this.page = 0;
        this.activeFilters = { ...this.filters };
        this.searchTotalsKnown = false;
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
    this.resultsEl.createDiv({ cls: 'streamradio-search-separator' });

    const customStationRow = this.contentEl.createDiv({ cls: 'streamradio-custom-station-action' });
    new ButtonComponent(customStationRow)
      .setButtonText('Add a custom radio stream')
      .onClick(() => {
        new CustomStationModal(this.app, this.plugin, (station) => {
          this.selected.set(station.stationuuid, station);
          this.onSaved();
        }).open();
      });

    void this.loadFacets();
  }

  onClose(): void {
    this.searchRequestId += 1;
    this.stopPreview();
    if (this.shouldResumePlaybackOnClose) {
      this.shouldResumePlaybackOnClose = false;
      void this.plugin.resumePlaybackWithFade();
    }
    this.countryDropdown = null;
    this.languageDropdown = null;
    this.tagDropdown = null;
    this.resultsEl = null;
    this.paginationEl = null;
    this.serverStatusEl = null;
    this.contentEl.empty();
  }

  private async loadFacets(): Promise<void> {
    void this.checkServerConnection();

    try {
      const [countries, languages, tags] = await fetchRadioBrowserFacets();
      this.populateDropdown(this.countryDropdown, countries, 'Any country');
      this.populateDropdown(this.languageDropdown, languages, 'Any language');
      this.populateDropdown(this.tagDropdown, tags, 'Any tag');
    } catch {
      this.renderServerStatus('disconnected');
    }
  }

  private async checkServerConnection(): Promise<void> {
    try {
      const stats = await fetchRadioBrowserServerStats();
      this.serverStationsCount = stats.stations || 0;
      this.renderServerStatus('connected', this.serverStationsCount);
    } catch {
      this.serverStationsCount = 0;
      this.renderServerStatus('disconnected', this.serverStationsCount);
    }
  }

  private renderServerStatus(status: 'hidden' | 'connected' | 'disconnected', totalStations = 0): void {
    if (!this.serverStatusEl) {
      return;
    }

    this.serverStatusEl.empty();
    this.serverStatusEl.toggleClass('is-connected', status === 'connected');
    this.serverStatusEl.toggleClass('is-disconnected', status === 'disconnected');
    this.serverStatusEl.toggleClass('is-hidden', status === 'hidden');

    if (status === 'hidden') {
      return;
    }

    this.serverStatusEl.createSpan({ cls: 'streamradio-server-status-indicator' });
    this.serverStatusEl.createSpan({ cls: 'streamradio-server-status-text', text: status === 'connected' ? 'Server connected.' : 'Server not connected. Try again later.' });
    this.serverStatusEl.createSpan({ cls: 'streamradio-server-status-count', text: `${totalStations.toLocaleString()} stations available.` });

    const refreshButton = this.serverStatusEl.createEl('button', {
      cls: 'clickable-icon streamradio-icon-button streamradio-server-status-refresh',
      attr: { type: 'button', 'aria-label': 'Refresh server status' },
    });
    setIcon(refreshButton, 'refresh-cw');
    refreshButton.addEventListener('click', () => {
      void this.checkServerConnection();
    });
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
      .forEach((facet) => {
        dropdown.addOption(facet.name, facet.name);
      });
  }

  private async search(): Promise<void> {
    if (!this.resultsEl) {
      return;
    }

    this.stopPreview();
    const requestId = this.searchRequestId + 1;
    this.searchRequestId = requestId;
    this.resultsEl.empty();
    this.resultsEl.createDiv({ cls: 'streamradio-empty-state', text: 'Searching...' });

    try {
      const knownTotalResults = this.searchTotalsKnown ? this.totalResults : undefined;
      const result = await searchRadioBrowserStations(this.activeFilters, this.page, knownTotalResults);
      if (requestId !== this.searchRequestId) {
        return;
      }

      this.hasNextPage = result.hasNextPage;
      this.totalResults = result.totalResults;
      this.totalPages = result.totalPages;
      this.searchTotalsKnown = true;
      this.results = result.stations;
      this.resultsById = new Map(result.stations.map((station) => [station.stationuuid, station]));
      this.renderResults();
    } catch {
      if (requestId !== this.searchRequestId) {
        return;
      }

      this.resultsEl.empty();
      this.resultsEl.createDiv({ cls: 'streamradio-empty-state', text: 'Search failed.' });
    }
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

      const previewButton = controls.createEl('button', {
        cls: 'clickable-icon streamradio-icon-button streamradio-preview-button',
        attr: { type: 'button', 'data-station-id': station.stationuuid },
      });
      this.updatePreviewButton(previewButton, station);
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
      this.updatePreviewButtons();
      return;
    }

    this.stopPreview();
    if (!this.shouldResumePlaybackOnClose && this.plugin.getIsPlaying()) {
      this.plugin.pausePlayback();
      this.shouldResumePlaybackOnClose = true;
    }

    const audio = new Audio(station.streamUrl);
    audio.preload = 'none';
    audio.addEventListener('error', () => {
      if (this.previewAudio === audio) {
        this.stopPreview();
        this.updatePreviewButtons();
        new Notice(`Could not preview ${station.name}.`);
      }
    });
    this.previewAudio = audio;
    this.previewStationId = station.stationuuid;
    this.updatePreviewButtons();

    try {
      await audio.play();
    } catch {
      this.stopPreview();
      this.updatePreviewButtons();
      new Notice(`Could not preview ${station.name}.`);
    }
  }

  private updatePreviewButtons(): void {
    if (!this.resultsEl) {
      return;
    }

    for (const button of Array.from(this.resultsEl.querySelectorAll<HTMLButtonElement>('.streamradio-preview-button'))) {
      const station = this.resultsById.get(button.dataset.stationId || '');
      if (station) {
        this.updatePreviewButton(button, station);
      }
    }
  }

  private updatePreviewButton(button: HTMLButtonElement, station: FavoriteStation): void {
    const isPreviewing = this.previewStationId === station.stationuuid;
    const iconName = isPreviewing ? 'square' : 'play';
    button.classList.toggle('is-active-playback', isPreviewing);
    button.style.setProperty('--streamradio-active-control-color', this.plugin.settings.pomodoroTimerColor);
    button.setAttr('aria-label', isPreviewing ? `Stop preview for ${station.name}` : `Preview ${station.name}`);
    if (button.dataset.icon !== iconName) {
      button.dataset.icon = iconName;
      setIcon(button, iconName);
    }
  }

  private stopPreview(restorePlayback = true): void {
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
    this.plugin.createStationLogo(parent, station, {
      wrapperClass: 'streamradio-station-logo-slot',
      imageClass: 'streamradio-station-logo',
      fallbackClass: 'streamradio-station-logo streamradio-logo-fallback',
      loading: 'lazy',
    });
  }
}

class CustomStationModal extends Modal {
  private previewAudio: HTMLAudioElement | null = null;
  private previewButton: HTMLButtonElement | null = null;
  private isPreviewing = false;
  private shouldResumePlaybackOnClose = false;

  constructor(app: App, private plugin: StreamRadioPluginApi, private onSaved: (station: FavoriteStation) => void) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Add custom radio stream');
    this.contentEl.empty();
    this.contentEl.addClass('streamradio-custom-station-modal');

    const nameField = this.createTextField('Radio name', 'Example FM', true);
    const streamUrlField = this.createTextField('Streaming URL', 'https://example.com/live-stream.mp3', true, 'url');
    const faviconField = this.createTextField('Favicon URL', 'https://example.com/favicon.png', false, 'url');
    const websiteField = this.createTextField('Website URL', 'https://example.com', false, 'url');

    streamUrlField.component.onChange(() => {
      this.stopPreview();
      this.updatePreviewButton(streamUrlField.component.getValue());
    });

    const previewRow = this.contentEl.createDiv({ cls: 'streamradio-custom-preview-row' });
    this.previewButton = previewRow.createEl('button', {
      cls: 'clickable-icon streamradio-icon-button streamradio-preview-button',
      attr: { type: 'button', 'aria-label': 'Preview custom stream' },
    });
    this.previewButton.addEventListener('click', () => {
      void this.togglePreview(nameField.component.getValue(), streamUrlField.component.getValue());
    });
    this.updatePreviewButton(streamUrlField.component.getValue());
    previewRow.createSpan({ cls: 'streamradio-custom-preview-label', text: 'Preview stream' });

    const actionRow = this.contentEl.createDiv({ cls: 'streamradio-modal-actions' });
    new ButtonComponent(actionRow)
      .setButtonText('Cancel')
      .onClick(() => {
        this.close();
      });
    new ButtonComponent(actionRow)
      .setButtonText('Save')
      .setCta()
      .onClick(() => {
        void this.saveCustomStation({
          name: nameField.component.getValue(),
          streamUrl: streamUrlField.component.getValue(),
          favicon: faviconField.component.getValue(),
          homepage: websiteField.component.getValue(),
        }, {
          name: nameField.errorEl,
          streamUrl: streamUrlField.errorEl,
          favicon: faviconField.errorEl,
          homepage: websiteField.errorEl,
        });
      });
  }

  onClose(): void {
    this.stopPreview();
    if (this.shouldResumePlaybackOnClose) {
      this.shouldResumePlaybackOnClose = false;
      void this.plugin.resumePlaybackWithFade();
    }
    this.contentEl.empty();
  }

  private createTextField(label: string, placeholder: string, required: boolean, inputType: HTMLInputElement['type'] = 'text'): { component: TextComponent; errorEl: HTMLElement } {
    const field = this.contentEl.createDiv({ cls: 'streamradio-custom-field' });
    field.createEl('label', { text: required ? `${label} *` : label });
    const component = new TextComponent(field).setPlaceholder(placeholder);
    component.inputEl.type = inputType;
    component.inputEl.required = required;
    component.inputEl.addClass('streamradio-custom-input');
    const errorEl = field.createDiv({ cls: 'streamradio-custom-field-error' });
    return { component, errorEl };
  }

  private async saveCustomStation(draft: CustomStationDraft, errorEls: Record<keyof CustomStationDraft, HTMLElement>): Promise<void> {
    const validation = this.validateDraft(draft);
    this.renderErrors(validation.errors, errorEls);
    if (!validation.station) {
      return;
    }

    await this.plugin.saveFavorites([...this.plugin.settings.favorites, validation.station]);
    this.onSaved(validation.station);
    new Notice(`Added ${validation.station.name}.`);
    this.close();
  }

  private validateDraft(draft: CustomStationDraft): { station: FavoriteStation | null; errors: Record<keyof CustomStationDraft, string> } {
    const errors: Record<keyof CustomStationDraft, string> = {
      name: '',
      streamUrl: '',
      favicon: '',
      homepage: '',
    };
    const name = draft.name.trim();
    const streamUrl = normalizeHttpUrl(draft.streamUrl);
    const favicon = normalizeHttpUrl(draft.favicon);
    const homepage = normalizeHttpUrl(draft.homepage);

    if (!name) {
      errors.name = 'Enter a radio name.';
    }

    if (!streamUrl) {
      errors.streamUrl = draft.streamUrl.trim() ? 'Enter a valid streaming URL.' : 'Enter a streaming URL.';
    }

    if (draft.favicon.trim() && !favicon) {
      errors.favicon = 'Enter a valid favicon URL.';
    }

    if (draft.homepage.trim() && !homepage) {
      errors.homepage = 'Enter a valid website URL.';
    }

    const hasErrors = Object.values(errors).some(Boolean);
    return {
      errors,
      station: hasErrors ? null : {
        stationuuid: createCustomStationId(),
        name,
        streamUrl,
        favicon,
        homepage,
        tags: 'Custom stream',
        codec: '',
        bitrate: 0,
        country: '',
        language: '',
      },
    };
  }

  private renderErrors(errors: Record<keyof CustomStationDraft, string>, errorEls: Record<keyof CustomStationDraft, HTMLElement>): void {
    for (const [fieldName, message] of Object.entries(errors) as Array<[keyof CustomStationDraft, string]>) {
      errorEls[fieldName].setText(message);
      errorEls[fieldName].toggleClass('is-visible', Boolean(message));
    }
  }

  private async togglePreview(name: string, streamUrlValue: string): Promise<void> {
    if (this.isPreviewing) {
      this.stopPreview();
      this.updatePreviewButton(streamUrlValue);
      return;
    }

    const streamUrl = normalizeHttpUrl(streamUrlValue);
    if (!streamUrl) {
      new Notice('Enter a valid streaming URL to preview.');
      return;
    }

    this.stopPreview();
    if (!this.shouldResumePlaybackOnClose && this.plugin.getIsPlaying()) {
      this.plugin.pausePlayback();
      this.shouldResumePlaybackOnClose = true;
    }
    const audio = new Audio(streamUrl);
    audio.preload = 'none';
    audio.addEventListener('error', () => {
      if (this.previewAudio === audio) {
        this.stopPreview();
        this.updatePreviewButton(streamUrlValue);
        new Notice(`Could not preview ${name.trim() || 'custom stream'}.`);
      }
    });
    this.previewAudio = audio;
    this.isPreviewing = true;
    this.updatePreviewButton(streamUrlValue);

    try {
      await audio.play();
    } catch {
      this.stopPreview();
      this.updatePreviewButton(streamUrlValue);
      new Notice(`Could not preview ${name.trim() || 'custom stream'}.`);
    }
  }

  private updatePreviewButton(streamUrlValue: string): void {
    if (!this.previewButton) {
      return;
    }

    const isValidPreviewUrl = Boolean(normalizeHttpUrl(streamUrlValue));
    const iconName = this.isPreviewing ? 'square' : 'play';
    this.previewButton.disabled = !isValidPreviewUrl;
    this.previewButton.classList.toggle('is-active-playback', this.isPreviewing);
    this.previewButton.style.setProperty('--streamradio-active-control-color', this.plugin.settings.pomodoroTimerColor);
    this.previewButton.setAttr('aria-label', this.isPreviewing ? 'Stop custom stream preview' : 'Preview custom stream');
    if (this.previewButton.dataset.icon !== iconName) {
      this.previewButton.dataset.icon = iconName;
      setIcon(this.previewButton, iconName);
    }
  }

  private stopPreview(): void {
    if (this.previewAudio) {
      this.previewAudio.pause();
      this.previewAudio.removeAttribute('src');
      this.previewAudio.load();
    }

    this.previewAudio = null;
    this.isPreviewing = false;
  }
}

function normalizeHttpUrl(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  try {
    const url = new URL(trimmedValue);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function createCustomStationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `custom-${crypto.randomUUID()}`;
  }

  return `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
