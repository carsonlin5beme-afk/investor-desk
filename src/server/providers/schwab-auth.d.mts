export const SCHWAB_AUTHORIZE_URL: string;
export const DEFAULT_SCHWAB_CALLBACK: string;
export function validateCallback(value?: string): string;
export function privateDirectory(directory: string): void;
export function readPrivateFile(file: string): string | null;
export type SchwabAuthStatus = {
  state:
    | "not_configured"
    | "not_connected"
    | "connected"
    | "refresh_due"
    | "invalid_storage"
    | "reconnect_required";
  detail: string;
  expiresAt?: string;
  authorizedAt?: string;
};
export type SchwabAuth = {
  configured(): boolean;
  status(): SchwabAuthStatus;
  accessToken(rejectedToken?: string): Promise<string>;
  exchangeCode(code: string): Promise<string>;
  rejectAccessToken(rejectedToken: string): Promise<void>;
  disconnect(): Promise<void>;
};
export function createSchwabAuth(config: {
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
  directory: string;
}): SchwabAuth;
export function schwabAuth(): SchwabAuth;
