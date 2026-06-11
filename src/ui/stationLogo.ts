import { setIcon } from 'obsidian';
import type { FavoriteStation, StationLogoOptions } from '../types';

export class StationLogoResolver {
  private unavailableStationIcons = new Set<string>();

  resolve(favicon: string): string | null {
    const normalizedUrl = favicon.trim();
    if (!normalizedUrl || this.unavailableStationIcons.has(normalizedUrl)) {
      return null;
    }

    return normalizedUrl;
  }

  markUnavailable(favicon: string): void {
    const normalizedUrl = favicon.trim();
    if (normalizedUrl) {
      this.unavailableStationIcons.add(normalizedUrl);
    }
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
  const resolvedUrl = resolver.resolve(requestedUrl);
  if (!resolvedUrl) {
    return wrapper;
  }

  const image = content.ownerDocument.createElement('img');
  image.className = options.imageClass;
  image.addClass('streamradio-station-logo-loading');
  image.alt = '';
  image.loading = options.loading ?? 'lazy';
  image.addEventListener('load', () => {
    if (!wrapper.isConnected || station.favicon !== requestedUrl) {
      return;
    }

    content.empty();
    image.removeClass('streamradio-station-logo-loading');
    content.appendChild(image);
  }, { once: true });
  image.addEventListener('error', () => {
    if (!wrapper.isConnected || station.favicon !== requestedUrl) {
      return;
    }

    resolver.markUnavailable(requestedUrl);
    renderFallbackStationLogo(content, options.fallbackClass);
  }, { once: true });
  content.appendChild(image);
  image.src = resolvedUrl;

  return wrapper;
}

function renderFallbackStationLogo(parent: HTMLElement, className: string): void {
  parent.empty();
  const fallback = parent.createDiv({ cls: className });
  setIcon(fallback, 'radio');
}
