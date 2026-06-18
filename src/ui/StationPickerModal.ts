import { App, Modal, setIcon } from 'obsidian';
import { bitrateLabel, stationFormat } from '../stationUtils';
import { StationSearchModal } from './StationSearchModal';
import type { StreamRadioPluginApi } from './pluginTypes';

class ConfirmFavoriteRemovalModal extends Modal {
  constructor(
    app: App,
    private stationName: string,
    private onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Remove favorite');

    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('p', { text: `Remove "${this.stationName}" from favorites?` });

    const actions = contentEl.createDiv({ cls: 'modal-button-container' });
    const cancelButton = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    const removeButton = actions.createEl('button', { text: 'Remove', cls: 'mod-warning', attr: { type: 'button' } });

    cancelButton.addEventListener('click', () => this.close());
    removeButton.addEventListener('click', () => {
      removeButton.disabled = true;
      cancelButton.disabled = true;
      void this.onConfirm().finally(() => this.close());
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class StationPickerModal extends Modal {
  constructor(app: App, private plugin: StreamRadioPluginApi) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.empty();
    this.titleEl.addClass('streamradio-picker-title');
    this.titleEl.createSpan({ text: 'Select station' });
    const addFavoritesButton = this.titleEl.createEl('button', {
      cls: 'mod-cta',
      text: '+ Add favorites',
      attr: { type: 'button' },
    });
    addFavoritesButton.addClass('streamradio-picker-add-favorites');
    addFavoritesButton.addEventListener('click', () => {
      new StationSearchModal(this.app, this.plugin, () => this.renderFavorites()).open();
    });

    this.contentEl.empty();
    this.contentEl.addClass('streamradio-picker-modal');
    this.renderFavorites();
  }

  onClose(): void {
    this.titleEl.removeClass('streamradio-picker-title');
    this.contentEl.empty();
  }

  private renderFavorites(): void {
    this.contentEl.empty();

    if (this.plugin.settings.favorites.length === 0) {
      this.contentEl.createDiv({ cls: 'streamradio-empty-state', text: 'No favorite stations yet.' });
      return;
    }

    for (const station of this.plugin.settings.favorites) {
      const row = this.contentEl.createDiv({ cls: 'streamradio-picker-row' });
      const selectButton = row.createEl('button', { cls: 'streamradio-picker-select', attr: { type: 'button' } });
      this.plugin.createStationLogo(selectButton, station, {
        wrapperClass: 'streamradio-station-logo-slot',
        imageClass: 'streamradio-station-logo',
        fallbackClass: 'streamradio-station-logo streamradio-logo-fallback',
        loading: 'lazy',
      });

      const text = selectButton.createDiv({ cls: 'streamradio-result-text' });
      text.createDiv({ cls: 'streamradio-station-name', text: station.name });
      text.createDiv({ cls: 'streamradio-station-meta', text: `${stationFormat(station)} · ${bitrateLabel(station.bitrate)}` });

      const removeButton = row.createEl('button', {
        cls: 'clickable-icon streamradio-icon-button',
        attr: { type: 'button', 'aria-label': `Remove ${station.name}` },
      });
      setIcon(removeButton, 'trash-2');
      removeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        new ConfirmFavoriteRemovalModal(this.app, station.name, async () => {
          await this.plugin.removeFavorite(station.stationuuid);
          this.renderFavorites();
        }).open();
      });

      selectButton.addEventListener('click', () => {
        this.close();
        void this.plugin.playStation(station);
      });
    }
  }
}
