export function createCallbackValidator(config: {
  state: string;
  callback: string;
  expiresAt: number;
}): (
  request: { method?: string; url?: string; host?: string },
  now?: number,
) => { kind: "invalid" | "denied" } | { kind: "code"; code: string };
export function prepareCallbackTLS(
  directory: string,
  now?: number,
): Promise<{ key: string | null; cert: string | null }>;
