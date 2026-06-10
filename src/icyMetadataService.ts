import http from 'http';
import https from 'https';
import { StreamReader } from 'icecast-parser/dist/StreamReader';

import type { IcyTrackMetadata } from './types';

const EMPTY_METADATA: IcyTrackMetadata = { title: '', artist: '' };
const EMPTY_METADATA_RETRY_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 30 * 1000;
const MAX_REDIRECTS = 5;
const METADATA_FIELD_FRAGMENT_PATTERN = /(?:^|[\s;|])Stream(?:Title|Url|Name|Genre)\s*=\s*['"]?.*$/i;
const PIPE_TRAILER_PATTERN = /\s*\|{2}.*$/;
const URL_PATTERN = /https?:\/\//i;
const NOISE_ONLY_PATTERN = /^[\s'"|_./\\:;,[\]{}()\-~^*+=\d]+$/;

type MetadataUpdateHandler = (metadata: IcyTrackMetadata) => void;

export class IcyMetadataService {
  private request: http.ClientRequest | null = null;
  private response: http.IncomingMessage | null = null;
  private reader: StreamReader | null = null;
  private retryTimeoutId: number | null = null;
  private streamUrl = '';
  private isStopped = true;
  private lastMetadataKey = '';

  constructor(private onMetadataUpdate: MetadataUpdateHandler) {}

  start(streamUrl: string): void {
    if (!streamUrl) {
      this.stop();
      return;
    }

    this.stop(false);
    this.streamUrl = streamUrl;
    this.isStopped = false;
    this.publishMetadata(EMPTY_METADATA);
    this.connect(streamUrl, 0);
  }

  stop(resetMetadata = true): void {
    this.isStopped = true;
    this.streamUrl = '';
    this.lastMetadataKey = '';

    this.clearRetry();
    this.closeConnection();

    if (resetMetadata) {
      this.publishMetadata(EMPTY_METADATA);
    }
  }

  private connect(streamUrl: string, redirectCount: number): void {
    if (this.isStopped || !this.streamUrl) {
      return;
    }

    let url: URL;
    try {
      url = new URL(streamUrl);
    } catch {
      this.scheduleRetry(ERROR_RETRY_MS);
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, {
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': 'StreamRadio Obsidian Plugin',
      },
      timeout: 15000,
    }, (response) => {
      if (this.isStopped) {
        response.destroy();
        return;
      }

      if (this.handleRedirect(response, url, redirectCount)) {
        return;
      }

      this.response = response;
      this.handleResponse(response);
    });

    this.request = request;
    request.once('timeout', () => {
      request.destroy(new Error('Timed out while connecting to stream metadata.'));
    });
    request.once('error', () => {
      this.closeConnection();
      this.scheduleRetry(ERROR_RETRY_MS);
    });
    request.end();
  }

  private handleRedirect(response: http.IncomingMessage, currentUrl: URL, redirectCount: number): boolean {
    const statusCode = response.statusCode ?? 0;
    const location = response.headers.location;

    if (statusCode < 300 || statusCode >= 400 || !location || redirectCount >= MAX_REDIRECTS) {
      return false;
    }

    const nextUrl = new URL(location, currentUrl).toString();
    response.destroy();
    this.closeConnection();
    this.connect(nextUrl, redirectCount + 1);
    return true;
  }

  private handleResponse(response: http.IncomingMessage): void {
    const icyMetaIntHeader = response.headers['icy-metaint'];
    const icyMetaInt = Array.isArray(icyMetaIntHeader) ? Number(icyMetaIntHeader[0]) : Number(icyMetaIntHeader);
    const headerMetadata = this.parseHeaderMetadata(response.headers);

    if (!Number.isFinite(icyMetaInt) || icyMetaInt <= 0) {
      this.publishMetadata(headerMetadata);
      this.closeConnection();
      this.scheduleRetry(EMPTY_METADATA_RETRY_MS);
      return;
    }

    this.publishMetadata(headerMetadata);

    const reader = new StreamReader(icyMetaInt);
    this.reader = reader;

    reader.on('metadata', (metadata: Map<string, string>) => {
      this.publishMetadata(this.parseMetadata(metadata, headerMetadata));
    });
    reader.on('data', () => undefined);
    reader.once('error', () => {
      this.closeConnection();
      this.scheduleRetry(ERROR_RETRY_MS);
    });
    response.once('error', () => {
      this.closeConnection();
      this.scheduleRetry(ERROR_RETRY_MS);
    });
    response.once('end', () => {
      this.closeConnection();
      this.scheduleRetry(ERROR_RETRY_MS);
    });
    response.pipe(reader);
  }

  private parseMetadata(metadata: Map<string, string>, fallbackMetadata: IcyTrackMetadata): IcyTrackMetadata {
    const streamTitle = this.cleanMetadataValue(metadata.get('StreamTitle') || '');
    if (!streamTitle) {
      return this.metadataFromFields(metadata, fallbackMetadata);
    }

    const [artistPart, ...titleParts] = streamTitle.split(/\s+[-\u2013\u2014]\s+/);
    const title = this.cleanMetadataValue(titleParts.join(' - '));
    const artist = this.cleanMetadataValue(artistPart);

    if (!titleParts.length) {
      return { title: streamTitle, artist: '' };
    }

    return this.coalesceMetadata({ title, artist }, fallbackMetadata);
  }

  private parseHeaderMetadata(headers: http.IncomingHttpHeaders): IcyTrackMetadata {
    return this.coalesceMetadata({
      title: this.cleanMetadataValue(this.getHeaderValue(headers['icy-genre']) || this.getHeaderValue(headers['icy-name']) || ''),
      artist: '',
    }, EMPTY_METADATA);
  }

  private metadataFromFields(metadata: Map<string, string>, fallbackMetadata: IcyTrackMetadata): IcyTrackMetadata {
    return this.coalesceMetadata({
      title: this.cleanMetadataValue(metadata.get('StreamGenre') || metadata.get('StreamName') || ''),
      artist: '',
    }, fallbackMetadata);
  }

  private coalesceMetadata(metadata: IcyTrackMetadata, fallbackMetadata: IcyTrackMetadata): IcyTrackMetadata {
    const title = this.cleanMetadataValue(metadata.title);
    const artist = this.cleanMetadataValue(metadata.artist);

    if (!title && !artist) {
      return fallbackMetadata;
    }

    return { title, artist };
  }

  private cleanMetadataValue(value: string): string {
    const normalized = value
      .replace(/\0/g, '')
      .replace(METADATA_FIELD_FRAGMENT_PATTERN, '')
      .replace(PIPE_TRAILER_PATTERN, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized || URL_PATTERN.test(normalized) || NOISE_ONLY_PATTERN.test(normalized)) {
      return '';
    }

    return normalized;
  }

  private getHeaderValue(header: string | string[] | undefined): string {
    return Array.isArray(header) ? header[0] || '' : header || '';
  }

  private publishMetadata(metadata: IcyTrackMetadata): void {
    const nextKey = `${metadata.title}\u0000${metadata.artist}`;
    if (nextKey === this.lastMetadataKey) {
      return;
    }

    this.lastMetadataKey = nextKey;
    this.onMetadataUpdate(metadata);
  }

  private scheduleRetry(delayMs: number): void {
    if (this.isStopped || !this.streamUrl) {
      return;
    }

    this.clearRetry();
    this.retryTimeoutId = window.setTimeout(() => {
      this.retryTimeoutId = null;
      this.connect(this.streamUrl, 0);
    }, delayMs);
  }

  private clearRetry(): void {
    if (this.retryTimeoutId !== null) {
      window.clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
  }

  private closeConnection(): void {
    if (this.response) {
      this.response.removeAllListeners();
      this.response.destroy();
      this.response = null;
    }

    if (this.reader) {
      this.reader.removeAllListeners();
      this.reader.destroy();
      this.reader = null;
    }

    if (this.request) {
      this.request.removeAllListeners();
      this.request.destroy();
      this.request = null;
    }
  }
}
