import type { LEGAL_HOLD_STATUS, RETENTION_MODES, RETENTION_VALIDITY_UNITS } from "./helpers.mjs";
import { TypedClient } from "./internal/client.mjs";
import { CopyConditions } from "./internal/copy-conditions.mjs";
import { PostPolicy } from "./internal/post-policy.mjs";
export * from "./errors.mjs";
export * from "./helpers.mjs";
export * from "./notification.mjs";
export { CopyConditions, PostPolicy };
export { IamAwsProvider } from "./IamAwsProvider.mjs";
export type { MakeBucketOpt } from "./internal/client.mjs";
export type { ClientOptions, NoResultCallback, RemoveOptions } from "./internal/client.mjs";
export type { Region } from "./internal/s3-endpoints.mjs";
export type { BucketItem, BucketItemCopy, BucketItemFromList, BucketItemStat, BucketItemWithMetadata, BucketStream, EmptyObject, ExistingObjectReplication, GetObjectLegalHoldOptions, IncompleteUploadedBucketItem, InputSerialization, IsoDate, ItemBucketMetadata, ItemBucketMetadataList, LegalHoldStatus, LifecycleConfig, LifecycleRule, MetadataItem, ObjectLockInfo, OutputSerialization, PostPolicyResult, PutObjectLegalHoldOptions, ReplicaModifications, ReplicationConfig, ReplicationConfigOpts, ReplicationRule, ReplicationRuleAnd, ReplicationRuleDestination, ReplicationRuleFilter, ReplicationRuleStatus, Retention, RetentionOptions, ScanRange, SelectOptions, SelectProgress, SourceSelectionCriteria, Tag } from "./internal/type.mjs";
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