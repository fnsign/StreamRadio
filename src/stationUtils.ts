import { MAX_VISIBLE_TAGS } from './constants';
import type { FavoriteStation, RadioBrowserStation } from './types';

export function toFavoriteStation(station: RadioBrowserStation): FavoriteStation {
  return {
    stationuuid: station.stationuuid,
    name: station.name || 'Unnamed station',
    streamUrl: station.url_resolved || station.url || '',
    favicon: station.favicon || '',
    homepage: station.homepage || '',
    tags: station.tags || '',
    codec: station.codec || '',
    bitrate: station.bitrate || 0,
    country: station.country || '',
    language: station.language || '',
  };
}

export function stationFormat(station: Pick<FavoriteStation, 'tags' | 'codec'>): string {
  if (station.tags.trim()) {
    return station.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, MAX_VISIBLE_TAGS).join(', ');
  }

  return station.codec || 'Unknown format';
}

export function bitrateLabel(bitrate: number): string {
  return bitrate > 0 ? `${bitrate} kbps` : 'Unknown bitrate';
}

export function normalizeFacetName(name: string): string {
  return name.trim();
}
