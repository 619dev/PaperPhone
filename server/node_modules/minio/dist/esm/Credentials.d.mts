export declare class Credentials {
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  constructor({
    accessKey,
    secretKey,
    sessionToken
  }: {
    accessKey: string;
    secretKey: string;
    sessionToken?: string;
  });
  setAccessKey(accessKey: string): void;
  getAccessKey(): string;
  setSecretKey(secretKey: string): void;
  getSecretKey(): string;
  setSessionToken(sessionToken: string): void;
  getSessionToken(): string | undefined;
  get(): Credentials;
}
export default Credentials;