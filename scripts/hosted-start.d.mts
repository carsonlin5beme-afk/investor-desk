import type { ChildProcess } from "node:child_process";
export function hostedStartConfig(env: NodeJS.ProcessEnv): {
  hostname: string;
  port: string;
};
export function startHosted(env?: NodeJS.ProcessEnv): ChildProcess;
