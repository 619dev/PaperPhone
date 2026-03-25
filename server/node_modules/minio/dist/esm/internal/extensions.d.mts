import type { TypedClient } from "./client.mjs";
import type { BucketItemWithMetadata, BucketStream } from "./type.mjs";
export declare class Extensions {
  private readonly client;
  constructor(client: TypedClient);
  /**
   * List the objects in the bucket using S3 ListObjects V2 With Metadata
   *
   * @param bucketName - name of the bucket
   * @param prefix - the prefix of the objects that should be listed (optional, default `''`)
   * @param recursive - `true` indicates recursive style listing and `false` indicates directory style listing delimited by '/'. (optional, default `false`)
   * @param startAfter - Specifies the key to start after when listing objects in a bucket. (optional, default `''`)
   * @returns stream emitting the objects in the bucket, the object is of the format:
   */
  listObjectsV2WithMetadata(bucketName: string, prefix?: string, recursive?: boolean, startAfter?: string): BucketStream<BucketItemWithMetadata>;
  private listObjectsV2WithMetadataGen;
  private listObjectsV2WithMetadataQuery;
}