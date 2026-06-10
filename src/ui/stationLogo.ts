import { requestUrl, setIcon } from 'obsidian';
import type { FavoriteStation, StationLogoOptions } from '../types';

export class StationLogoResolver {
  private stationIconAvailability = new Map<string, Promise<string | null>>();

  async resolve(favicon: string): Promise<string | null> {
    const normalizedUrl = favicon.trim();
    if (!normalizedUrl) {
      return null;
    }

    let pending = this.stationIconAvailability.get(normalizedUrl);
    if (!pending) {
      pending = requestUrl({
        url: normalizedUrl,
        method: 'HEAD',
        headers: {
          'User-Agent': 'StreamRadio/1.2.0',
        },
      })
        .then((response) => (response.status >= 200 && response.status < 400 ? normalizedUrl : null))
        .catch(() => null);
      this.stationIconAvailability.set(normalizedUrl, pending);
    }

    return pending;
  }
}

export function createStationLogo(parent: HTMLElement, station: Pick<FavoriteStation, 'favicon' | 'name'>, options: StationLogoOptions, resolver: StationLogoResolver): HTMLElement {
  const wrapper = parent.createDiv({ cls: options.wrapperClass });
  const content = wrapper.createDiv({ cls: 'streamradio-station-logo-content' });
  renderFallbackStationLogo(content, options.fallbackClass);

  if (!station.favicon) {
    return wrapper;
  }

  const requestedUrl = station.favicon;
  void resolver.resolve(requestedUrl).then((resolvedUrl) => {
    if (!wrapper.isConnected || station.favicon !== requestedUrl || !resolvedUrl) {
      return;
    }

    content.empty();
    content.createEl('img', {
      cls: options.imageClass,
      attr: {
        src: resolvedUrl,
        alt: '',
        loading: options.loading ?? 'lazy',
      },
    });
  });

  return wrapper;
}

function renderFallbackStationLogo(parent: HTMLElement, className: string): void {
  parent.empty();
  const fallback = parent.createDiv({ cls: className });
  setIcon(fallback, 'radio');
}
