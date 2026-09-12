type Entry = { until: number; value: unknown };
const cache = new Map<string, Entry>(),
  cooldown = new Map<string, number>(),
  pending = new Map<string, Promise<unknown>>();
export async function providerRequest<T>(
  provider: string,
  url: string,
  headers: Record<string, string> = {},
  ttlMs = 0,
  options: { bypassCache?: boolean } = {},
): Promise<T> {
  const key = provider + url,
    cached = cache.get(key);
  if (!options.bypassCache && cached && cached.until > Date.now())
    return cached.value as T;
  if ((cooldown.get(provider) ?? 0) > Date.now())
    throw new Error(`${provider}: rate-limited; waiting before retry`);
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const promise = (async () => {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      if (response.status === 429 || response.status === 503) {
        const retry = Number(response.headers.get("retry-after"));
        cooldown.set(
          provider,
          Date.now() +
            (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 120) : 30) *
              1000,
        );
      }
      throw new Error(
        `${provider}: ${response.status === 401 || response.status === 403 ? "credentials/entitlement" : response.status === 429 ? "rate limit" : "upstream error"} (${response.status})`,
      );
    }
    const data = await response.json();
    if (ttlMs) {
      if (cache.size > 2000) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: Date.now() + ttlMs, value: data });
    }
    return data as T;
  })();
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    pending.delete(key);
  }
}
