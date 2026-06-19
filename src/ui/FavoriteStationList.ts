import { setIcon } from 'obsidian';
import { bitrateLabel, stationFormat } from '../stationUtils';
import type { FavoriteStation } from '../types';
import type { StreamRadioPluginApi } from './pluginTypes';

interface FavoriteStationListOptions {
  plugin: StreamRadioPluginApi;
  onPlayStation?: (station: FavoriteStation) => Promise<void> | void;
  onStopStation?: (station: FavoriteStation) => Promise<void> | void;
  onRemoveStation?: (station: FavoriteStation) => Promise<void> | void;
  onSelectStation?: (station: FavoriteStation) => Promise<void> | void;
  onReorderFavorites?: (favorites: FavoriteStation[]) => Promise<void> | void;
  draggable?: boolean;
  emptyStateText?: string;
  listClassName?: string;
}

export function renderFavoriteStationList(parent: HTMLElement, options: FavoriteStationListOptions): void {
  const list = parent.createDiv({ cls: 'streamradio-favorite-list' });
  if (options.listClassName) {
    list.addClass(options.listClassName);
  }

  const favorites = options.plugin.settings.favorites;
  if (favorites.length === 0) {
    list.createDiv({ cls: 'streamradio-empty-state', text: options.emptyStateText ?? 'No favorite stations yet.' });
    return;
  }

  favorites.forEach((station, index) => {
    const row = list.createDiv({ cls: 'streamradio-favorite-row' });
    if (options.draggable) {
      row.setAttr('draggable', 'true');
      row.setAttr('data-index', String(index));
    }

    if (options.draggable) {
      const handle = row.createSpan({ cls: 'streamradio-drag-handle' });
      setIcon(handle, 'grip-vertical');
    }

    options.plugin.createStationLogo(row, station, {
      wrapperClass: 'streamradio-station-logo-slot',
      imageClass: 'streamradio-station-logo',
      fallbackClass: 'streamradio-station-logo streamradio-logo-fallback',
      loading: 'lazy',
    });

    const text = row.createDiv({ cls: 'streamradio-favorite-text' });
    text.createDiv({ cls: 'streamradio-station-name', text: station.name });
    text.createDiv({ cls: 'streamradio-station-meta', text: `${stationFormat(station)} · ${bitrateLabel(station.bitrate)}` });

    const hasActions = Boolean(options.onPlayStation || options.onStopStation || options.onRemoveStation);
    const actions = hasActions ? row.createDiv({ cls: 'streamradio-row-actions' }) : null;
    const isActiveStationPlaying = options.plugin.getIsPlaying() && options.plugin.getCurrentStation()?.stationuuid === station.stationuuid;

    if (actions && (options.onPlayStation || options.onStopStation)) {
      const playButton = actions.createEl('button', {
        cls: 'clickable-icon streamradio-icon-button',
        attr: { type: 'button', 'aria-label': isActiveStationPlaying ? `Stop ${station.name}` : `Play ${station.name}` },
      });
      playButton.classList.toggle('is-active-playback', isActiveStationPlaying);
      playButton.style.setProperty('--streamradio-active-control-color', options.plugin.settings.pomodoroTimerColor);
      setIcon(playButton, isActiveStationPlaying ? 'square' : 'play');
      playButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isActiveStationPlaying) {
          void Promise.resolve(options.onStopStation?.(station));
          return;
        }

        void Promise.resolve(options.onPlayStation?.(station));
      });
    }

    if (actions && options.onRemoveStation) {
      const removeButton = actions.createEl('button', {
        cls: 'clickable-icon streamradio-icon-button',
        attr: { type: 'button', 'aria-label': `Remove ${station.name}` },
      });
      setIcon(removeButton, 'trash-2');
      removeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void Promise.resolve(options.onRemoveStation?.(station));
      });
    }

    if (options.onSelectStation) {
      row.addClass('streamradio-picker-row');
      row.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button')) {
          return;
        }

        void Promise.resolve(options.onSelectStation?.(station));
      });
    }

    if (options.draggable && options.onReorderFavorites) {
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

      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const fromIndex = Number(event.dataTransfer?.getData('text/plain'));
        const toIndex = index;
        if (!Number.isInteger(fromIndex) || fromIndex === toIndex) {
          return;
        }

        const reorderedFavorites = [...options.plugin.settings.favorites];
        const [moved] = reorderedFavorites.splice(fromIndex, 1);
        reorderedFavorites.splice(toIndex, 0, moved);
        void Promise.resolve(options.onReorderFavorites?.(reorderedFavorites));
      });
    }
  });
}