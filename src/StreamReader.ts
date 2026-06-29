/// <reference types="node" />

import { Transform } from 'stream';
import type { TransformCallback } from 'stream';

const METADATA_BLOCK_SIZE = 16;
const METADATA_REGEX = /(?<key>\w+)=['"](?<value>[^'";]*)['"];/gu;

const enum StreamReaderState {
  Init = 0,
  Buffering = 1,
  Passthrough = 2,
}

type Continuation<T> = T | (() => Continuation<T>);

function parseMetadata(metadata: Buffer): Map<string, string> {
  const map = new Map<string, string>();
  const data = metadata.toString('utf8').replace(/\0*$/u, '');

  for (const part of data.matchAll(METADATA_REGEX)) {
    map.set(part.groups?.key ?? '', part.groups?.value ?? '');
  }

  return map;
}

function trampoline<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => Continuation<TResult>) {
  return function executor(...args: TArgs): TResult {
    let result = fn(...args);
    while (typeof result === 'function') {
      result = (result as () => Continuation<TResult>)();
    }
    return result;
  };
}

function processData(stream: StreamReader, chunk: Buffer, done: TransformCallback): TransformCallback | void {
  stream.bytesLeft -= chunk.length;

  if (stream.currentState === StreamReaderState.Buffering) {
    stream.buffers.push(chunk);
    stream.buffersLength += chunk.length;
  } else if (stream.currentState === StreamReaderState.Passthrough) {
    stream.push(chunk);
  }

  if (stream.bytesLeft === 0) {
    const { callback } = stream;
    const chunkToPass = stream.currentState === StreamReaderState.Buffering && stream.buffers.length > 1
      ? Buffer.concat(stream.buffers, stream.buffersLength)
      : chunk;

    stream.currentState = StreamReaderState.Init;
    stream.callback = null;
    stream.buffers.splice(0);
    stream.buffersLength = 0;
    callback?.call(stream, chunkToPass);
  }

  return done;
}

const onData = trampoline((stream: StreamReader, chunk: Buffer, done: TransformCallback) => {
  if (chunk.length <= stream.bytesLeft) {
    return () => processData(stream, chunk, done);
  }

  return () => {
    const buffer = chunk.slice(0, stream.bytesLeft);
    return processData(stream, buffer, (error) => {
      if (error !== null && typeof error !== 'undefined') {
        return done(error);
      }

      if (chunk.length > buffer.length) {
        return () => onData(stream, chunk.slice(buffer.length), done);
      }

      return undefined;
    });
  };
});

export class StreamReader extends Transform {
  buffers: Buffer[] = [];
  buffersLength = 0;
  bytesLeft = 0;
  callback: ((chunk: Buffer) => void) | null = null;
  currentState = StreamReaderState.Init;

  constructor(readonly icyMetaInt: number) {
    super();
    this.passthrough(this.icyMetaInt, this.onMetaSectionStart.bind(this));
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    onData(this, chunk, done);
  }

  protected bytes(length: number, callback: (chunk: Buffer) => void): void {
    this.bytesLeft = length;
    this.currentState = StreamReaderState.Buffering;
    this.callback = callback;
  }

  protected passthrough(length: number, callback: (chunk: Buffer) => void): void {
    this.bytesLeft = length;
    this.currentState = StreamReaderState.Passthrough;
    this.callback = callback;
  }

  protected onMetaSectionStart(): void {
    this.bytes(1, this.onMetaSectionLengthByte.bind(this));
  }

  protected onMetaSectionLengthByte(chunk: Buffer): void {
    const length = chunk[0] * METADATA_BLOCK_SIZE;

    if (length > 0) {
      this.bytes(length, this.onMetaData.bind(this));
      return;
    }

    this.passthrough(this.icyMetaInt, this.onMetaSectionStart.bind(this));
  }

  protected onMetaData(chunk: Buffer): void {
    this.emit('metadata', parseMetadata(chunk));
    this.passthrough(this.icyMetaInt, this.onMetaSectionStart.bind(this));
  }
}