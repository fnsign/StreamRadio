import { App, Modal } from 'obsidian';
import type { FavoriteStation } from '../types';
import { ConfirmFavoriteRemovalModal } from './ConfirmFavoriteRemovalModal';
import { renderFavoriteStationList } from './FavoriteStationList';
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

  private async playSelectedStation(station: FavoriteStation): Promise<void> {
    this.close();
    await this.plugin.playStation(station);
  }

  private renderFavorites(): void {
    this.contentEl.empty();

    renderFavoriteStationList(this.contentEl, {
      plugin: this.plugin,
      draggable: true,
      listClassName: 'streamradio-picker-list',
      onPlayStation: (station) => this.playSelectedStation(station),
      onStopStation: () => {
        this.plugin.stopPlayback();
        this.renderFavorites();
      },
      onRemoveStation: (station) => {
        new ConfirmFavoriteRemovalModal(this.app, station.name, async () => {
          await this.plugin.removeFavorite(station.stationuuid);
          this.renderFavorites();
        }).open();
      },
      onSelectStation: (station) => this.playSelectedStation(station),
      onReorderFavorites: async (favorites) => {
        await this.plugin.saveFavorites(favorites);
        this.renderFavorites();
      },
    });
  }
}
