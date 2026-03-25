import type { ObjectMetaData } from "./type.mjs";
export declare class PostPolicy {
  policy: {
    conditions: (string | number)[][];
    expiration?: string;
  };
  formData: Record<string, string>;
  setExpires(date: Date): void;
  setKey(objectName: string): void;
  setKeyStartsWith(prefix: string): void;
  setBucket(bucketName: string): void;
  setContentType(type: string): void;
  setContentTypeStartsWith(prefix: string): void;
  setContentDisposition(value: string): void;
  setContentLengthRange(min: number, max: number): void;
  setUserMetaData(metaData: ObjectMetaData): void;
}