/// <reference types="node" />
/// <reference types="node" />
import type * as http from 'node:http';
import { SelectResults } from "../helpers.js";
import type { BucketItemFromList, BucketItemWithMetadata, CopyObjectResultV1, ListObjectV2Res, NotificationConfigResult, ObjectInfo, ObjectLockInfo, ReplicationConfig, Tag } from "./type.js";
export declare function parseBucketRegion(xml: string): string;
export declare function parseError(xml: string, headerInfo: Record<string, unknown>): Record<string, unknown>;
export declare function parseResponseError(response: http.IncomingMessage): Promise<Record<string, string>>;
/**
 * parse XML response for list objects v2 with metadata in a bucket
 */
export declare function parseListObjectsV2WithMetadata(xml: string): {
  objects: Array<BucketItemWithMetadata>;
  isTruncated: boolean;
  nextContinuationToken: string;
};
export declare function parseListObjectsV2(xml: string): ListObjectV2Res;
export declare function parseBucketNotification(xml: string): NotificationConfigResult;
export type UploadedPart = {
  part: number;
  lastModified?: Date;
  etag: string;
  size: number;
};
export declare function parseListParts(xml: string): {
  isTruncated: boolean;
  marker: number;
  parts: UploadedPart[];
};
export declare function parseListBucket(xml: string): BucketItemFromList[];
export declare function parseInitiateMultipart(xml: string): string;
export declare function parseReplicationConfig(xml: string): ReplicationConfig;
export declare function parseObjectLegalHoldConfig(xml: string): any;
export declare function parseTagging(xml: string): Tag[];
export declare function parseCompleteMultipart(xml: string): {
  location: any;
  bucket: any;
  key: any;
  etag: any;
  errCode?: undefined;
  errMessage?: undefined;
} | {
  errCode: any;
  errMessage: any;
  location?: undefined;
  bucket?: undefined;
  key?: undefined;
  etag?: undefined;
} | undefined;
type UploadID = string;
export type ListMultipartResult = {
  uploads: {
    key: string;
    uploadId: UploadID;
    initiator?: {
      id: string;
      displayName: string;
    };
    owner?: {
      id: string;
      displayName: string;
    };
    storageClass: unknown;
    initiated: Date;
  }[];
  prefixes: {
    prefix: string;
  }[];
  isTruncated: boolean;
  nextKeyMarker: string;
  nextUploadIdMarker: string;
};
export declare function parseListMultipart(xml: string): ListMultipartResult;
export declare function parseObjectLockConfig(xml: string): ObjectLockInfo;
export declare function parseBucketVersioningConfig(xml: string): any;
export declare function parseSelectObjectContentResponse(res: Buffer): SelectResults | undefined;
export declare function parseLifecycleConfig(xml: string): any;
export declare function parseBucketEncryptionConfig(xml: string): any;
export declare function parseObjectRetentionConfig(xml: string): {
  mode: any;
  retainUntilDate: any;
};
export declare function removeObjectsParser(xml: string): any[];
export declare function parseCopyObject(xml: string): CopyObjectResultV1;
export declare function parseListObjects(xml: string): {
  objects: ObjectInfo[];
  isTruncated?: boolean | undefined;
  nextMarker?: string | undefined;
  versionIdMarker?: string | undefined;
  keyMarker?: string | undefined;
};
export declare function uploadPartParser(xml: string): any;
export {};