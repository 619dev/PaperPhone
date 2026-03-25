/// <reference types="node" />
/// <reference types="node" />
import * as fs from 'node:fs';
import * as stream from 'node:stream';
export { promises as fsp } from 'node:fs';
export declare const streamPromise: {
  pipeline: typeof stream.pipeline.__promisify__;
};
export declare const fstat: typeof fs.fstat.__promisify__;