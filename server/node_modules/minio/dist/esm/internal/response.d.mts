/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import type http from 'node:http';
import type stream from 'node:stream';
export declare function readAsBuffer(res: stream.Readable): Promise<Buffer>;
export declare function readAsString(res: http.IncomingMessage): Promise<string>;
export declare function drainResponse(res: stream.Readable): Promise<void>;