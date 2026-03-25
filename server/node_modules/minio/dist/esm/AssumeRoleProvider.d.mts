/// <reference types="node" />
import * as http from 'node:http';
import { CredentialProvider } from "./CredentialProvider.mjs";
import { Credentials } from "./Credentials.mjs";
/**
 * @see https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
 */
type CredentialResponse = {
  ErrorResponse?: {
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
  AssumeRoleResponse: {
    AssumeRoleResult: {
      Credentials: {
        AccessKeyId: string;
        SecretAccessKey: string;
        SessionToken: string;
        Expiration: string;
      };
    };
  };
};
export interface AssumeRoleProviderOptions {
  stsEndpoint: string;
  accessKey: string;
  secretKey: string;
  durationSeconds?: number;
  sessionToken?: string;
  policy?: string;
  region?: string;
  roleArn?: string;
  roleSessionName?: string;
  externalId?: string;
  token?: string;
  webIdentityToken?: string;
  action?: string;
  transportAgent?: http.Agent;
}
export declare class AssumeRoleProvider extends CredentialProvider {
  private readonly stsEndpoint;
  private readonly accessKey;
  private readonly secretKey;
  private readonly durationSeconds;
  private readonly policy?;
  private readonly region;
  private readonly roleArn?;
  private readonly roleSessionName?;
  private readonly externalId?;
  private readonly token?;
  private readonly webIdentityToken?;
  private readonly action;
  private _credentials;
  private readonly expirySeconds;
  private accessExpiresAt;
  private readonly transportAgent?;
  private readonly transport;
  constructor({
    stsEndpoint,
    accessKey,
    secretKey,
    durationSeconds,
    sessionToken,
    policy,
    region,
    roleArn,
    roleSessionName,
    externalId,
    token,
    webIdentityToken,
    action,
    transportAgent
  }: AssumeRoleProviderOptions);
  getRequestConfig(): {
    requestOptions: http.RequestOptions;
    requestData: string;
  };
  performRequest(): Promise<CredentialResponse>;
  parseCredentials(respObj: CredentialResponse): Credentials;
  refreshCredentials(): Promise<Credentials>;
  getCredentials(): Promise<Credentials>;
  isAboutToExpire(): boolean;
}
export default AssumeRoleProvider;