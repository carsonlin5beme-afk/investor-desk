export type DeploymentOrigin = {
  origin: string;
  host: string;
  local: boolean;
  trustedOrigins: string[];
};
export function deploymentOrigin(value?: string): DeploymentOrigin;
export function validPort(value: unknown): boolean;
export function isLoopbackHost(host: string): boolean;
