import type { Encryption, ObjectMetaData, RequestHeaders } from "./internal/type.mjs";
import { RETENTION_MODES } from "./internal/type.mjs";
export { ENCRYPTION_TYPES, LEGAL_HOLD_STATUS, RETENTION_MODES, RETENTION_VALIDITY_UNITS } from "./internal/type.mjs";
export declare const DEFAULT_REGION = "us-east-1";
export declare const PRESIGN_EXPIRY_DAYS_MAX: number;
export interface ICopySourceOptions {
  Bucket: string;
  Object: string;
  /**
   * Valid versionId
   */
  VersionID?: string;
  /**
   * Etag to match
   */
  MatchETag?: string;
  /**
   * Etag to exclude
   */
  NoMatchETag?: string;
  /**
   * Modified Date of the object/part.  UTC Date in string format
   */
  MatchModifiedSince?: string | null;
  /**
   * Modified Date of the object/part to exclude UTC Date in string format
   */
  MatchUnmodifiedSince?: string | null;
  /**
   * true or false Object range to match
   */
  MatchRange?: boolean;
  Start?: number;
  End?: number;
  Encryption?: Encryption;
}
export declare class CopySourceOptions {
  readonly Bucket: string;
  readonly Object: string;
  readonly VersionID: string;
  MatchETag: string;
  private readonly NoMatchETag;
  private readonly MatchModifiedSince;
  private readonly MatchUnmodifiedSince;
  readonly MatchRange: boolean;
  readonly Start: number;
  readonly End: number;
  private readonly Encryption?;
  constructor({
    Bucket,
    Object,
    VersionID,
    MatchETag,
    NoMatchETag,
    MatchModifiedSince,
    MatchUnmodifiedSince,
    MatchRange,
    Start,
    End,
    Encryption
  }: ICopySourceOptions);
  validate(): boolean;
  getHeaders(): RequestHeaders;
}
/**
 * @deprecated use nodejs fs module
 */
export declare function removeDirAndFiles(dirPath: string, removeSelf?: boolean): void;
export interface ICopyDestinationOptions {
  /**
   * Bucket name
   */
  Bucket: string;
  /**
   * Object Name for the destination (composed/copied) object defaults
   */
  Object: string;
  /**
   * Encryption configuration defaults to {}
   * @default {}
   */
  Encryption?: Encryption;
  UserMetadata?: ObjectMetaData;
  /**
   * query-string encoded string or Record<string, string> Object
   */
  UserTags?: Record<string, string> | string;
  LegalHold?: 'on' | 'off';
  /**
   * UTC Date String
   */
  RetainUntilDate?: string;
  Mode?: RETENTION_MODES;
  MetadataDirective?: 'COPY' | 'REPLACE';
  /**
   * Extra headers for the target object
   */
  Headers?: Record<string, string>;
}
export declare class CopyDestinationOptions {
  readonly Bucket: string;
  readonly Object: string;
  private readonly Encryption?;
  private readonly UserMetadata?;
  private readonly UserTags?;
  private readonly LegalHold?;
  private readonly RetainUntilDate?;
  private readonly Mode?;
  private readonly MetadataDirective?;
  private readonly Headers?;
  constructor({
    Bucket,
    Object,
    Encryption,
    UserMetadata,
    UserTags,
    LegalHold,
    RetainUntilDate,
    Mode,
    MetadataDirective,
    Headers
  }: ICopyDestinationOptions);
  getHeaders(): RequestHeaders;
  validate(): boolean;
}
/**
 * maybe this should be a generic type for Records, leave it for later refactor
 */
export declare class SelectResults {
  private records?;
  private response?;
  private stats?;
  private progress?;
  constructor({
    records,
    // parsed data as stream
    response,
    // original response stream
    stats,
    // stats as xml
    progress
  }: {
    records?: unknown;
    response?: unknown;
    stats?: string;
    progress?: unknown;
  });
  setStats(stats: string): void;
  getStats(): string | undefined;
  setProgress(progress: unknown): void;
  getProgress(): unknown;
  setResponse(response: unknown): void;
  getResponse(): unknown;
  setRecords(records: unknown): void;
  getRecords(): unknown;
}