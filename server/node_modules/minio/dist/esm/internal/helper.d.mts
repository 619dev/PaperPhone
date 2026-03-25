/// <reference types="node" />
/// <reference types="node" />
import * as stream from 'node:stream';
import _ from 'lodash';
import type { Binary, Encryption, ObjectMetaData, RequestHeaders, ResponseHeader } from "./type.mjs";
export declare function hashBinary(buf: Buffer, enableSHA256: boolean): {
  md5sum: string;
  sha256sum: string;
};
export declare function uriEscape(uriStr: string): string;
export declare function uriResourceEscape(string: string): string;
export declare function getScope(region: string, date: Date, serviceName?: string): string;
/**
 * isAmazonEndpoint - true if endpoint is 's3.amazonaws.com' or 's3.cn-north-1.amazonaws.com.cn'
 */
export declare function isAmazonEndpoint(endpoint: string): boolean;
/**
 * isVirtualHostStyle - verify if bucket name is support with virtual
 * hosts. bucketNames with periods should be always treated as path
 * style if the protocol is 'https:', this is due to SSL wildcard
 * limitation. For all other buckets and Amazon S3 endpoint we will
 * default to virtual host style.
 */
export declare function isVirtualHostStyle(endpoint: string, protocol: string, bucket: string, pathStyle: boolean): boolean;
export declare function isValidIP(ip: string): boolean;
/**
 * @returns if endpoint is valid domain.
 */
export declare function isValidEndpoint(endpoint: string): boolean;
/**
 * @returns if input host is a valid domain.
 */
export declare function isValidDomain(host: string): boolean;
/**
 * Probes contentType using file extensions.
 *
 * @example
 * ```
 * // return 'image/png'
 * probeContentType('file.png')
 * ```
 */
export declare function probeContentType(path: string): string;
/**
 * is input port valid.
 */
export declare function isValidPort(port: unknown): port is number;
export declare function isValidBucketName(bucket: unknown): boolean;
/**
 * check if objectName is a valid object name
 */
export declare function isValidObjectName(objectName: unknown): boolean;
/**
 * check if prefix is valid
 */
export declare function isValidPrefix(prefix: unknown): prefix is string;
/**
 * check if typeof arg number
 */
export declare function isNumber(arg: unknown): arg is number;
export type AnyFunction = (...args: any[]) => any;
/**
 * check if typeof arg function
 */
export declare function isFunction(arg: unknown): arg is AnyFunction;
/**
 * check if typeof arg string
 */
export declare function isString(arg: unknown): arg is string;
/**
 * check if typeof arg object
 */
export declare function isObject(arg: unknown): arg is object;
/**
 * check if typeof arg is plain object
 */
export declare function isPlainObject(arg: unknown): arg is Record<string, unknown>;
/**
 * check if object is readable stream
 */
export declare function isReadableStream(arg: unknown): arg is stream.Readable;
/**
 * check if arg is boolean
 */
export declare function isBoolean(arg: unknown): arg is boolean;
export declare function isEmpty(o: unknown): o is null | undefined;
export declare function isEmptyObject(o: Record<string, unknown>): boolean;
export declare function isDefined<T>(o: T): o is Exclude<T, null | undefined>;
/**
 * check if arg is a valid date
 */
export declare function isValidDate(arg: unknown): arg is Date;
/**
 * Create a Date string with format: 'YYYYMMDDTHHmmss' + Z
 */
export declare function makeDateLong(date?: Date): string;
/**
 * Create a Date string with format: 'YYYYMMDD'
 */
export declare function makeDateShort(date?: Date): string;
/**
 * pipesetup sets up pipe() from left to right os streams array
 * pipesetup will also make sure that error emitted at any of the upstream Stream
 * will be emitted at the last stream. This makes error handling simple
 */
export declare function pipesetup(...streams: [stream.Readable, ...stream.Duplex[], stream.Writable]): stream.Readable | stream.Duplex | stream.Writable;
/**
 * return a Readable stream that emits data
 */
export declare function readableStream(data: unknown): stream.Readable;
/**
 * Process metadata to insert appropriate value to `content-type` attribute
 */
export declare function insertContentType(metaData: ObjectMetaData, filePath: string): ObjectMetaData;
/**
 * Function prepends metadata with the appropriate prefix if it is not already on
 */
export declare function prependXAMZMeta(metaData?: ObjectMetaData): RequestHeaders;
/**
 * Checks if it is a valid header according to the AmazonS3 API
 */
export declare function isAmzHeader(key: string): boolean;
/**
 * Checks if it is a supported Header
 */
export declare function isSupportedHeader(key: string): boolean;
/**
 * Checks if it is a storage header
 */
export declare function isStorageClassHeader(key: string): boolean;
export declare function extractMetadata(headers: ResponseHeader): _.Dictionary<string>;
export declare function getVersionId(headers?: ResponseHeader): string | null;
export declare function getSourceVersionId(headers?: ResponseHeader): string | null;
export declare function sanitizeETag(etag?: string): string;
export declare function toMd5(payload: Binary): string;
export declare function toSha256(payload: Binary): string;
/**
 * toArray returns a single element array with param being the element,
 * if param is just a string, and returns 'param' back if it is an array
 * So, it makes sure param is always an array
 */
export declare function toArray<T = unknown>(param: T | T[]): Array<T>;
export declare function sanitizeObjectKey(objectName: string): string;
export declare function sanitizeSize(size?: string): number | undefined;
export declare const PART_CONSTRAINTS: {
  ABS_MIN_PART_SIZE: number;
  MIN_PART_SIZE: number;
  MAX_PARTS_COUNT: number;
  MAX_PART_SIZE: number;
  MAX_SINGLE_PUT_OBJECT_SIZE: number;
  MAX_MULTIPART_PUT_OBJECT_SIZE: number;
};
/**
 * Return Encryption headers
 * @param encConfig
 * @returns an object with key value pairs that can be used in headers.
 */
export declare function getEncryptionHeaders(encConfig: Encryption): RequestHeaders;
export declare function partsRequired(size: number): number;
/**
 * calculateEvenSplits - computes splits for a source and returns
 * start and end index slices. Splits happen evenly to be sure that no
 * part is less than 5MiB, as that could fail the multipart request if
 * it is not the last part.
 */
export declare function calculateEvenSplits<T extends {
  Start?: number;
}>(size: number, objInfo: T): {
  startIndex: number[];
  objInfo: T;
  endIndex: number[];
} | null;
export declare function parseXml(xml: string): any;
/**
 * get content size of object content to upload
 */
export declare function getContentLength(s: stream.Readable | Buffer | string): Promise<number | null>;