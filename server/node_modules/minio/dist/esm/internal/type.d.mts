/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import type * as http from 'node:http';
import type { Readable as ReadableStream } from 'node:stream';
import type { CopyDestinationOptions, CopySourceOptions } from "../helpers.mjs";
import type { CopyConditions } from "./copy-conditions.mjs";
export type VersionIdentificator = {
  versionId?: string;
};
export type GetObjectOpts = VersionIdentificator & {
  SSECustomerAlgorithm?: string;
  SSECustomerKey?: string;
  SSECustomerKeyMD5?: string;
};
export type Binary = string | Buffer;
export type ResponseHeader = Record<string, string>;
export type ObjectMetaData = Record<string, string | number>;
export type RequestHeaders = Record<string, string | boolean | number | undefined>;
export type EnabledOrDisabledStatus = 'Enabled' | 'Disabled';
export declare const ENCRYPTION_TYPES: {
  readonly SSEC: "SSE-C";
  readonly KMS: "KMS";
};
export type ENCRYPTION_TYPES = (typeof ENCRYPTION_TYPES)[keyof typeof ENCRYPTION_TYPES];
export type Encryption = {
  type: typeof ENCRYPTION_TYPES.SSEC;
} | {
  type: typeof ENCRYPTION_TYPES.KMS;
  SSEAlgorithm?: string;
  KMSMasterKeyID?: string;
};
export declare const RETENTION_MODES: {
  readonly GOVERNANCE: "GOVERNANCE";
  readonly COMPLIANCE: "COMPLIANCE";
};
export type RETENTION_MODES = (typeof RETENTION_MODES)[keyof typeof RETENTION_MODES];
export declare const RETENTION_VALIDITY_UNITS: {
  readonly DAYS: "Days";
  readonly YEARS: "Years";
};
export type RETENTION_VALIDITY_UNITS = (typeof RETENTION_VALIDITY_UNITS)[keyof typeof RETENTION_VALIDITY_UNITS];
export declare const LEGAL_HOLD_STATUS: {
  readonly ENABLED: "ON";
  readonly DISABLED: "OFF";
};
export type LEGAL_HOLD_STATUS = (typeof LEGAL_HOLD_STATUS)[keyof typeof LEGAL_HOLD_STATUS];
export type Transport = Pick<typeof http, 'request'>;
export interface IRequest {
  protocol: string;
  port?: number | string;
  method: string;
  path: string;
  headers: RequestHeaders;
}
export type ICanonicalRequest = string;
export interface IncompleteUploadedBucketItem {
  key: string;
  uploadId: string;
  size: number;
}
export interface MetadataItem {
  Key: string;
  Value: string;
}
export interface ItemBucketMetadataList {
  Items: MetadataItem[];
}
export interface ItemBucketMetadata {
  [key: string]: any;
}
export interface ItemBucketTags {
  [key: string]: any;
}
export interface BucketItemFromList {
  name: string;
  creationDate: Date;
}
export interface BucketItemCopy {
  etag: string;
  lastModified: Date;
}
export type BucketItem = {
  name: string;
  size: number;
  etag: string;
  prefix?: never;
  lastModified: Date;
} | {
  name?: never;
  etag?: never;
  lastModified?: never;
  prefix: string;
  size: 0;
};
export type BucketItemWithMetadata = BucketItem & {
  metadata?: ItemBucketMetadata | ItemBucketMetadataList;
  tags?: ItemBucketTags;
};
export interface BucketStream<T> extends ReadableStream {
  on(event: 'data', listener: (item: T) => void): this;
  on(event: 'end' | 'pause' | 'readable' | 'resume' | 'close', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}
export interface BucketItemStat {
  size: number;
  etag: string;
  lastModified: Date;
  metaData: ItemBucketMetadata;
  versionId?: string | null;
}
export type StatObjectOpts = {
  versionId?: string;
};
export type ReplicationRuleStatus = {
  Status: EnabledOrDisabledStatus;
};
export type Tag = {
  Key: string;
  Value: string;
};
export type Tags = Record<string, string>;
export type ReplicationRuleDestination = {
  Bucket: string;
  StorageClass: string;
};
export type ReplicationRuleAnd = {
  Prefix: string;
  Tags: Tag[];
};
export type ReplicationRuleFilter = {
  Prefix: string;
  And: ReplicationRuleAnd;
  Tag: Tag;
};
export type ReplicaModifications = {
  Status: ReplicationRuleStatus;
};
export type SourceSelectionCriteria = {
  ReplicaModifications: ReplicaModifications;
};
export type ExistingObjectReplication = {
  Status: ReplicationRuleStatus;
};
export type ReplicationRule = {
  ID: string;
  Status: ReplicationRuleStatus;
  Priority: number;
  DeleteMarkerReplication: ReplicationRuleStatus;
  DeleteReplication: ReplicationRuleStatus;
  Destination: ReplicationRuleDestination;
  Filter: ReplicationRuleFilter;
  SourceSelectionCriteria: SourceSelectionCriteria;
  ExistingObjectReplication: ExistingObjectReplication;
};
export type ReplicationConfigOpts = {
  role: string;
  rules: ReplicationRule[];
};
export type ReplicationConfig = {
  ReplicationConfiguration: ReplicationConfigOpts;
};
export type ResultCallback<T> = (error: Error | null, result: T) => void;
export type GetObjectLegalHoldOptions = {
  versionId: string;
};
/**
 * @deprecated keep for backward compatible, use `LEGAL_HOLD_STATUS` instead
 */
export type LegalHoldStatus = LEGAL_HOLD_STATUS;
export type PutObjectLegalHoldOptions = {
  versionId?: string;
  status: LEGAL_HOLD_STATUS;
};
export interface UploadedObjectInfo {
  etag: string;
  versionId: string | null;
}
export interface RetentionOptions {
  versionId: string;
  mode?: RETENTION_MODES;
  retainUntilDate?: IsoDate;
  governanceBypass?: boolean;
}
export type Retention = RetentionOptions | EmptyObject;
export type IsoDate = string;
export type EmptyObject = Record<string, never>;
export type ObjectLockInfo = {
  objectLockEnabled: EnabledOrDisabledStatus;
  mode: RETENTION_MODES;
  unit: RETENTION_VALIDITY_UNITS;
  validity: number;
} | EmptyObject;
export type ObjectLockConfigParam = {
  ObjectLockEnabled?: 'Enabled' | undefined;
  Rule?: {
    DefaultRetention: {
      Mode: RETENTION_MODES;
      Days: number;
      Years: number;
    } | EmptyObject;
  } | EmptyObject;
};
export type VersioningEnabled = 'Enabled';
export type VersioningSuspended = 'Suspended';
export type TaggingOpts = {
  versionId: string;
};
export type PutTaggingParams = {
  bucketName: string;
  objectName?: string;
  tags: Tags;
  putOpts?: TaggingOpts;
};
export type RemoveTaggingParams = {
  bucketName: string;
  objectName?: string;
  removeOpts?: TaggingOpts;
};
export type InputSerialization = {
  CompressionType?: 'NONE' | 'GZIP' | 'BZIP2';
  CSV?: {
    AllowQuotedRecordDelimiter?: boolean;
    Comments?: string;
    FieldDelimiter?: string;
    FileHeaderInfo?: 'NONE' | 'IGNORE' | 'USE';
    QuoteCharacter?: string;
    QuoteEscapeCharacter?: string;
    RecordDelimiter?: string;
  };
  JSON?: {
    Type: 'DOCUMENT' | 'LINES';
  };
  Parquet?: EmptyObject;
};
export type OutputSerialization = {
  CSV?: {
    FieldDelimiter?: string;
    QuoteCharacter?: string;
    QuoteEscapeCharacter?: string;
    QuoteFields?: string;
    RecordDelimiter?: string;
  };
  JSON?: {
    RecordDelimiter?: string;
  };
};
export type SelectProgress = {
  Enabled: boolean;
};
export type ScanRange = {
  Start: number;
  End: number;
};
export type SelectOptions = {
  expression: string;
  expressionType?: string;
  inputSerialization: InputSerialization;
  outputSerialization: OutputSerialization;
  requestProgress?: SelectProgress;
  scanRange?: ScanRange;
};
export type Expiration = {
  Date?: string;
  Days: number;
  DeleteMarker?: boolean;
  DeleteAll?: boolean;
};
export type RuleFilterAnd = {
  Prefix: string;
  Tags: Tag[];
};
export type RuleFilter = {
  And?: RuleFilterAnd;
  Prefix: string;
  Tag?: Tag[];
};
export type NoncurrentVersionExpiration = {
  NoncurrentDays: number;
  NewerNoncurrentVersions?: number;
};
export type NoncurrentVersionTransition = {
  StorageClass: string;
  NoncurrentDays?: number;
  NewerNoncurrentVersions?: number;
};
export type Transition = {
  Date?: string;
  StorageClass: string;
  Days: number;
};
export type AbortIncompleteMultipartUpload = {
  DaysAfterInitiation: number;
};
export type LifecycleRule = {
  AbortIncompleteMultipartUpload?: AbortIncompleteMultipartUpload;
  ID: string;
  Prefix?: string;
  Status?: string;
  Expiration?: Expiration;
  Filter?: RuleFilter;
  NoncurrentVersionExpiration?: NoncurrentVersionExpiration;
  NoncurrentVersionTransition?: NoncurrentVersionTransition;
  Transition?: Transition;
};
export type LifecycleConfig = {
  Rule: LifecycleRule[];
};
export type LifeCycleConfigParam = LifecycleConfig | null | undefined | '';
export type ApplySSEByDefault = {
  KmsMasterKeyID?: string;
  SSEAlgorithm: string;
};
export type EncryptionRule = {
  ApplyServerSideEncryptionByDefault?: ApplySSEByDefault;
};
export type EncryptionConfig = {
  Rule: EncryptionRule[];
};
export type GetObjectRetentionOpts = {
  versionId: string;
};
export type ObjectRetentionInfo = {
  mode: RETENTION_MODES;
  retainUntilDate: string;
};
export type RemoveObjectsEntry = {
  name: string;
  versionId?: string;
};
export type ObjectName = string;
export type RemoveObjectsParam = ObjectName[] | RemoveObjectsEntry[];
export type RemoveObjectsRequestEntry = {
  Key: string;
  VersionId?: string;
};
export type RemoveObjectsResponse = null | undefined | {
  Error?: {
    Code?: string;
    Message?: string;
    Key?: string;
    VersionId?: string;
  };
};
export type CopyObjectResultV1 = {
  etag: string;
  lastModified: string | Date;
};
export type CopyObjectResultV2 = {
  Bucket?: string;
  Key?: string;
  LastModified: string | Date;
  MetaData?: ResponseHeader;
  VersionId?: string | null;
  SourceVersionId?: string | null;
  Etag?: string;
  Size?: number;
};
export type CopyObjectResult = CopyObjectResultV1 | CopyObjectResultV2;
export type CopyObjectParams = [CopySourceOptions, CopyDestinationOptions] | [string, string, string, CopyConditions?];
export type ExcludedPrefix = {
  Prefix: string;
};
export type BucketVersioningConfiguration = {
  Status: VersioningEnabled | VersioningSuspended;
  MFADelete?: string;
  ExcludedPrefixes?: ExcludedPrefix[];
  ExcludeFolders?: boolean;
};
export type UploadPartConfig = {
  bucketName: string;
  objectName: string;
  uploadID: string;
  partNumber: number;
  headers: RequestHeaders;
  sourceObj: string;
};
export type PreSignRequestParams = {
  [key: string]: string;
};
/** List object api types **/
export type CommonPrefix = {
  Prefix: string;
};
export type Owner = {
  ID: string;
  DisplayName: string;
};
export type Metadata = {
  Items: MetadataItem[];
};
export type ObjectInfo = {
  key?: string;
  name?: string;
  lastModified?: Date;
  etag?: string;
  owner?: Owner;
  storageClass?: string;
  userMetadata?: Metadata;
  userTags?: string;
  prefix?: string;
  size?: number;
};
export type ListObjectQueryRes = {
  isTruncated?: boolean;
  nextMarker?: string;
  objects?: ObjectInfo[];
  keyMarker?: string;
  versionIdMarker?: string;
};
export type ListObjectQueryOpts = {
  Delimiter?: string;
  MaxKeys?: number;
  IncludeVersion?: boolean;
  keyMarker?: string;
  versionIdMarker?: string;
};
/** List object api types **/
export type ObjectVersionEntry = {
  IsLatest?: string;
  VersionId?: string;
};
export type ObjectRowEntry = ObjectVersionEntry & {
  Key: string;
  LastModified?: Date | undefined;
  ETag?: string;
  Size?: string;
  Owner?: Owner;
  StorageClass?: string;
};
export type ListObjectV2Res = {
  objects: BucketItem[];
  isTruncated: boolean;
  nextContinuationToken: string;
};
export type NotificationConfigEntry = {
  Id: string;
  Event: string[];
  Filter: {
    Name: string;
    Value: string;
  }[];
};
export type TopicConfigEntry = NotificationConfigEntry & {
  Topic: string;
};
export type QueueConfigEntry = NotificationConfigEntry & {
  Queue: string;
};
export type CloudFunctionConfigEntry = NotificationConfigEntry & {
  CloudFunction: string;
};
export type NotificationConfigResult = {
  TopicConfiguration: TopicConfigEntry[];
  QueueConfiguration: QueueConfigEntry[];
  CloudFunctionConfiguration: CloudFunctionConfigEntry[];
};
export interface ListBucketResultV1 {
  Name?: string;
  Prefix?: string;
  ContinuationToken?: string;
  KeyCount?: string;
  Marker?: string;
  MaxKeys?: string;
  Delimiter?: string;
  IsTruncated?: boolean;
  Contents?: ObjectRowEntry[];
  NextKeyMarker?: string;
  CommonPrefixes?: CommonPrefix[];
  Version?: ObjectRowEntry[];
  DeleteMarker?: ObjectRowEntry[];
  VersionIdMarker?: string;
  NextVersionIdMarker?: string;
  NextMarker?: string;
}
export interface PostPolicyResult {
  postURL: string;
  formData: {
    [key: string]: any;
  };
}