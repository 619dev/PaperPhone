import { EventEmitter } from 'eventemitter3';
import type { TypedClient } from "./internal/client.mjs";
type Event = unknown;
export declare class TargetConfig {
  private Filter?;
  private Event?;
  private Id;
  setId(id: unknown): void;
  addEvent(newevent: Event): void;
  addFilterSuffix(suffix: string): void;
  addFilterPrefix(prefix: string): void;
}
export declare class TopicConfig extends TargetConfig {
  private Topic;
  constructor(arn: string);
}
export declare class QueueConfig extends TargetConfig {
  private Queue;
  constructor(arn: string);
}
export declare class CloudFunctionConfig extends TargetConfig {
  private CloudFunction;
  constructor(arn: string);
}
export declare class NotificationConfig {
  private TopicConfiguration?;
  private CloudFunctionConfiguration?;
  private QueueConfiguration?;
  add(target: TargetConfig): void;
}
export declare const buildARN: (partition: string, service: string, region: string, accountId: string, resource: string) => string;
export declare const ObjectCreatedAll = "s3:ObjectCreated:*";
export declare const ObjectCreatedPut = "s3:ObjectCreated:Put";
export declare const ObjectCreatedPost = "s3:ObjectCreated:Post";
export declare const ObjectCreatedCopy = "s3:ObjectCreated:Copy";
export declare const ObjectCreatedCompleteMultipartUpload = "s3:ObjectCreated:CompleteMultipartUpload";
export declare const ObjectRemovedAll = "s3:ObjectRemoved:*";
export declare const ObjectRemovedDelete = "s3:ObjectRemoved:Delete";
export declare const ObjectRemovedDeleteMarkerCreated = "s3:ObjectRemoved:DeleteMarkerCreated";
export declare const ObjectReducedRedundancyLostObject = "s3:ReducedRedundancyLostObject";
export type NotificationEvent = 's3:ObjectCreated:*' | 's3:ObjectCreated:Put' | 's3:ObjectCreated:Post' | 's3:ObjectCreated:Copy' | 's3:ObjectCreated:CompleteMultipartUpload' | 's3:ObjectRemoved:*' | 's3:ObjectRemoved:Delete' | 's3:ObjectRemoved:DeleteMarkerCreated' | 's3:ReducedRedundancyLostObject' | 's3:TestEvent' | 's3:ObjectRestore:Post' | 's3:ObjectRestore:Completed' | 's3:Replication:OperationFailedReplication' | 's3:Replication:OperationMissedThreshold' | 's3:Replication:OperationReplicatedAfterThreshold' | 's3:Replication:OperationNotTracked' | string;
export type NotificationRecord = unknown;
export declare class NotificationPoller extends EventEmitter<{
  notification: (event: NotificationRecord) => void;
  error: (error: unknown) => void;
}> {
  private client;
  private bucketName;
  private prefix;
  private suffix;
  private events;
  private ending;
  constructor(client: TypedClient, bucketName: string, prefix: string, suffix: string, events: NotificationEvent[]);
  start(): void;
  stop(): void;
  checkForChanges(): void;
}
export {};