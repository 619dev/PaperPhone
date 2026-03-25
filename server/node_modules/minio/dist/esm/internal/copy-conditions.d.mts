export declare class CopyConditions {
  modified: string;
  unmodified: string;
  matchETag: string;
  matchETagExcept: string;
  setModified(date: Date): void;
  setUnmodified(date: Date): void;
  setMatchETag(etag: string): void;
  setMatchETagExcept(etag: string): void;
}