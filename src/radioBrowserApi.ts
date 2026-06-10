import { requestUrl } from 'obsidian';
import { RADIO_BROWSER_BASE_URL, SEARCH_COUNT_LIMIT, SEARCH_PAGE_SIZE } from './constants';
import { toFavoriteStation } from './stationUtils';
import type { FavoriteStation, RadioBrowserFacet, RadioBrowserStation, SearchFilters } from './types';

export interface StationSearchResult {
  stations: FavoriteStation[];
  hasNextPage: boolean;
  totalPages: number;
  totalResults: number;
}

export async function fetchRadioBrowser<T>(path: string): Promise<T> {
  const response = await requestUrl({
    url: `${RADIO_BROWSER_BASE_URL}${path}`,
    method: 'GET',
    headers: {
      'User-Agent': 'StreamRadio/1.1.0',
    },
  });

  return response.json as T;
}

export async function fetchRadioBrowserFacets(): Promise<[RadioBrowserFacet[], RadioBrowserFacet[], RadioBrowserFacet[]]> {
  return Promise.all([
    fetchRadioBrowser<RadioBrowserFacet[]>('/countries'),
    fetchRadioBrowser<RadioBrowserFacet[]>('/languages'),
    fetchRadioBrowser<RadioBrowserFacet[]>('/tags'),
  ]);
}

export async function searchRadioBrowserStations(filters: SearchFilters, page: number): Promise<StationSearchResult> {
  const pageQuery = createSearchQuery(filters, SEARCH_PAGE_SIZE + 1, page * SEARCH_PAGE_SIZE);
  const countQuery = createSearchQuery(filters, SEARCH_COUNT_LIMIT, 0);
  const [stations, countStations] = await Promise.all([
    fetchRadioBrowser<RadioBrowserStation[]>(`/stations/search?${pageQuery.toString()}`),
    fetchRadioBrowser<RadioBrowserStation[]>(`/stations/search?${countQuery.toString()}`),
  ]);
  const playableStations = stations.map(toFavoriteStation).filter((station) => station.streamUrl);
  const totalResults = countStations.filter((station) => station.url_resolved || station.url).length;

  return {
    stations: playableStations.slice(0, SEARCH_PAGE_SIZE),
    hasNextPage: playableStations.length > SEARCH_PAGE_SIZE,
    totalResults,
    totalPages: Math.max(1, Math.ceil(totalResults / SEARCH_PAGE_SIZE)),
  };
}

function createSearchQuery(filters: SearchFilters, limit: number, offset: number): URLSearchParams {
  const query = new URLSearchParams();
  query.set('hidebroken', 'true');
  query.set('order', 'clickcount');
  query.set('reverse', 'true');
  query.set('limit', String(limit));
  query.set('offset', String(offset));

  if (filters.name.trim()) {
    query.set('name', filters.name.trim());
  }
  if (filters.country) {
    query.set('country', filters.country);
  }
  if (filters.language) {
    query.set('language', filters.language);
  }
  if (filters.tag) {
    query.set('tag', filters.tag);
  }

  return query;
}
