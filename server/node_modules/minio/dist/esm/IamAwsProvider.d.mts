/// <reference types="node" />
import * as http from 'node:http';
import { CredentialProvider } from "./CredentialProvider.mjs";
import { Credentials } from "./Credentials.mjs";
export interface IamAwsProviderOptions {
  customEndpoint?: string;
  transportAgent?: http.Agent;
}
export declare class IamAwsProvider extends CredentialProvider {
  private readonly customEndpoint?;
  private _credentials;
  private readonly transportAgent?;
  private accessExpiresAt;
  constructor({
    customEndpoint,
    transportAgent
  }: IamAwsProviderOptions);
  getCredentials(): Promise<Credentials>;
  private fetchCredentials;
  private fetchCredentialsUsingTokenFile;
  private fetchImdsToken;
  private getIamRoleNamedUrl;
  private getIamRoleName;
  private requestCredentials;
  private isAboutToExpire;
}
export default IamAwsProvider;