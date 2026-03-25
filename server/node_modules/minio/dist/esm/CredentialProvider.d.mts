import { Credentials } from "./Credentials.mjs";
export declare class CredentialProvider {
  private credentials;
  constructor({
    accessKey,
    secretKey,
    sessionToken
  }: {
    accessKey: string;
    secretKey: string;
    sessionToken?: string;
  });
  getCredentials(): Promise<Credentials>;
  setCredentials(credentials: Credentials): void;
  setAccessKey(accessKey: string): void;
  getAccessKey(): string;
  setSecretKey(secretKey: string): void;
  getSecretKey(): string;
  setSessionToken(sessionToken: string): void;
  getSessionToken(): string | undefined;
}
export default CredentialProvider;