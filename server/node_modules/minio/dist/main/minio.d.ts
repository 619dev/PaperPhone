import type { LEGAL_HOLD_STATUS, RETENTION_MODES, RETENTION_VALIDITY_UNITS } from "./helpers.js";
import { TypedClient } from "./internal/client.js";
import { CopyConditions } from "./internal/copy-conditions.js";
import { PostPolicy } from "./internal/post-policy.js";
export * from "./errors.js";
export * from "./helpers.js";
export * from "./notification.js";
export { CopyConditions, PostPolicy };
export { IamAwsProvider } from "./IamAwsProvider.js";
export type { MakeBucketOpt } from "./internal/client.js";
export type { ClientOptions, NoResultCallback, RemoveOptions } from "./internal/client.js";
export type { Region } from "./internal/s3-endpoints.js";
export type { BucketItem, BucketItemCopy, BucketItemFromList, BucketItemStat, BucketItemWithMetadata, BucketStream, EmptyObject, ExistingObjectReplication, GetObjectLegalHoldOptions, IncompleteUploadedBucketItem, InputSerialization, IsoDate, ItemBucketMetadata, ItemBucketMetadataList, LegalHoldStatus, LifecycleConfig, LifecycleRule, MetadataItem, ObjectLockInfo, OutputSerialization, PostPolicyResult, PutObjectLegalHoldOptions, ReplicaModifications, ReplicationConfig, ReplicationConfigOpts, ReplicationRule, ReplicationRuleAnd, ReplicationRuleDestination, ReplicationRuleFilter, ReplicationRuleStatus, Retention, RetentionOptions, ScanRange, SelectOptions, SelectProgress, SourceSelectionCriteria, Tag } from "./internal/type.js";
/**
 * @deprecated keep for backward compatible, use `RETENTION_MODES` instead
 */
export type Mode = RETENTION_MODES;
/**
 * @deprecated keep for backward compatible
 */
export type LockUnit = RETENTION_VALIDITY_UNITS;
export type VersioningConfig = Record<string | number | symbol, unknown>;
export type TagList = Record<string, string>;
export interface LockConfig {
  mode: RETENTION_MODES;
  unit: RETENTION_VALIDITY_UNITS;
  validity: number;
}
export interface LegalHoldOptions {
  versionId: string;
  status: LEGAL_HOLD_STATUS;
}
export interface SourceObjectStats {
  size: number;
  metaData: string;
  lastModicied: Date;
  versionId: string;
  etag: string;
}
export declare class Client extends TypedClient {}