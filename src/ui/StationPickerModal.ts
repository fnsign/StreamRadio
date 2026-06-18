import { App, Modal } from 'obsidian';
import { bitrateLabel, stationFormat } from '../stationUtils';
import { StationSearchModal } from './StationSearchModal';
import type { StreamRadioPluginApi } from './pluginTypes';

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
      const button = this.contentEl.createEl('button', { cls: 'streamradio-picker-row', attr: { type: 'button' } });
      this.plugin.createStationLogo(button, station, {
        wrapperClass: 'streamradio-station-logo-slot',
        imageClass: 'streamradio-station-logo',
        fallbackClass: 'streamradio-station-logo streamradio-logo-fallback',
        loading: 'lazy',
      });

      const text = button.createDiv({ cls: 'streamradio-result-text' });
      text.createDiv({ cls: 'streamradio-station-name', text: station.name });
      text.createDiv({ cls: 'streamradio-station-meta', text: `${stationFormat(station)} · ${bitrateLabel(station.bitrate)}` });

      button.addEventListener('click', () => {
        this.close();
        void this.plugin.playStation(station);
      });
    }
  }
}
