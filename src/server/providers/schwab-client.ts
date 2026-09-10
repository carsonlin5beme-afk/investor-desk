import { schwabAuth } from "./schwab-auth.mjs";
import { readSchwabJson } from "./schwab-http.mjs";
const BASE = "https://api.schwabapi.com/marketdata/v1";
const PATHS = new Set(["/quotes", "/chains", "/expirationchain"]);
const pending = new Map<string, Promise<unknown>>();
let cooldownUntil = 0;
export const schwabConfigured = () => schwabAuth().configured();
export const schwabStatus = () => schwabAuth().status();
export const schwabConnected = () =>
  ["connected", "refresh_due"].includes(schwabStatus().state);

// Deliberately no generic URL, method, brokerage, or account API support.
export async function schwabGet<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  if (!PATHS.has(path))
    throw new Error("Schwab: unsupported market-data endpoint.");
  if (Date.now() < cooldownUntil)
    throw new Error("Schwab: rate-limited; retry shortly.");
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  if (pending.has(url)) return pending.get(url) as Promise<T>;
  const request = (async () => {
    let token = await schwabAuth().accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new Error("Schwab: market-data request failed or timed out.");
      }
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        token = await schwabAuth().accessToken(token);
        continue;
      }
      if (response.status === 429 || response.status === 503) {
        const retry = Number(response.headers.get("retry-after"));
        cooldownUntil =
          Date.now() +
          (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 120) : 30) *
            1000;
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401)
          await schwabAuth().rejectAccessToken(token);
        throw new Error(
          `Schwab: ${response.status === 401 ? "authorization expired; reconnect locally" : response.status === 403 ? "market-data entitlement denied" : response.status === 429 ? "rate limit" : "market-data service error"} (${response.status}).`,
        );
      }
      try {
        return (await readSchwabJson(response)) as T;
      } catch {
        throw new Error("Schwab: invalid market-data response.");
      }
    }
    throw new Error("Schwab: reconnect locally.");
  })();
  pending.set(url, request);
  try {
    return await request;
  } finally {
    pending.delete(url);
  }
}
