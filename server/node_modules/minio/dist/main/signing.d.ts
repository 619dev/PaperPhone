import type { IRequest } from "./internal/type.js";
export declare function postPresignSignatureV4(region: string, date: Date, secretKey: string, policyBase64: string): string;
export declare function signV4(request: IRequest, accessKey: string, secretKey: string, region: string, requestDate: Date, sha256sum: string, serviceName?: string): string;
export declare function signV4ByServiceName(request: IRequest, accessKey: string, secretKey: string, region: string, requestDate: Date, contentSha256: string, serviceName?: string): string;
export declare function presignSignatureV4(request: IRequest, accessKey: string, secretKey: string, sessionToken: string | undefined, region: string, requestDate: Date, expires: number | undefined): string;