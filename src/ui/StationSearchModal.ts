import { App, ButtonComponent, DropdownComponent, Modal, Notice, TextComponent, setIcon } from 'obsidian';
import { fetchRadioBrowserFacets, searchRadioBrowserStations } from '../radioBrowserApi';
import { bitrateLabel, normalizeFacetName, stationFormat } from '../stationUtils';
import type { FavoriteStation, RadioBrowserFacet, SearchFilters } from '../types';
import type { StreamRadioPluginApi } from './pluginTypes';

export class StationSearchModal extends Modal {
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
      const [countries, languages, tags] = await fetchRadioBrowserFacets();
      this.populateDropdown(this.countryDropdown, countries, 'Any country');
      this.populateDropdown(this.languageDropdown, languages, 'Any language');
      this.populateDropdown(this.tagDropdown, tags, 'Any tag');
    } catch {
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
      .forEach((facet) => {
        dropdown.addOption(facet.name, facet.name);
      });
  }

  private async search(): Promise<void> {
    if (!this.resultsEl) {
      return;
    }

    this.stopPreview();
    this.resultsEl.empty();
    this.resultsEl.createDiv({ cls: 'streamradio-empty-state', text: 'Searching...' });

    try {
      const result = await searchRadioBrowserStations(this.filters, this.page);
      this.hasNextPage = result.hasNextPage;
      this.totalResults = result.totalResults;
      this.totalPages = result.totalPages;
      this.results = result.stations;
      this.renderResults();
    } catch {
      this.resultsEl.empty();
      this.resultsEl.createDiv({ cls: 'streamradio-empty-state', text: 'Search failed. Try again later.' });
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
    } catch {
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
    this.plugin.createStationLogo(parent, station, {
      wrapperClass: 'streamradio-station-logo-slot',
      imageClass: 'streamradio-station-logo',
      fallbackClass: 'streamradio-station-logo streamradio-logo-fallback',
      loading: 'lazy',
    });
  }
}
