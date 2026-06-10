import http from 'http';
import https from 'https';
import { StreamReader } from 'icecast-parser/dist/StreamReader';

import type { IcyTrackMetadata } from './types';

const FALLBACK_METADATA: IcyTrackMetadata = { title: '-', artist: '-' };
const EMPTY_METADATA_RETRY_MS = 5 * 60 * 1000;
const ERROR_RETRY_MS = 30 * 1000;
const MAX_REDIRECTS = 5;

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
    this.publishMetadata(FALLBACK_METADATA);
    this.connect(streamUrl, 0);
  }

  stop(resetMetadata = true): void {
    this.isStopped = true;
    this.streamUrl = '';
    this.lastMetadataKey = '';

    this.clearRetry();
    this.closeConnection();

    if (resetMetadata) {
      this.publishMetadata(FALLBACK_METADATA);
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

    if (!Number.isFinite(icyMetaInt) || icyMetaInt <= 0) {
      this.closeConnection();
      this.scheduleRetry(EMPTY_METADATA_RETRY_MS);
      return;
    }

    const reader = new StreamReader(icyMetaInt);
    this.reader = reader;

    reader.on('metadata', (metadata: Map<string, string>) => {
      this.publishMetadata(this.parseMetadata(metadata));
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

  private parseMetadata(metadata: Map<string, string>): IcyTrackMetadata {
    const streamTitle = (metadata.get('StreamTitle') || '').trim();
    if (!streamTitle) {
      return FALLBACK_METADATA;
    }

    const [artistPart, ...titleParts] = streamTitle.split(' - ');
    const title = titleParts.join(' - ').trim();
    const artist = artistPart.trim();

    if (!title) {
      return { title: streamTitle, artist: '-' };
    }

    return {
      title: title || '-',
      artist: artist || '-',
    };
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
