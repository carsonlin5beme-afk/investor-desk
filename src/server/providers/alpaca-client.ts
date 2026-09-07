import { env } from "@/lib/env";
import { providerRequest } from "./request";

export const alpacaConfigured = () =>
  Boolean(env.ALPACA_API_KEY && env.ALPACA_API_SECRET);
export function alpacaGet<T>(
  path: string,
  params: Record<string, string> = {},
  reference = false,
  ttl = 1000,
): Promise<T> {
  const base = reference
    ? env.ALPACA_REFERENCE_BASE_URL
    : env.ALPACA_DATA_BASE_URL;
  return providerRequest<T>(
    "Alpaca",
    `${base}${path}?${new URLSearchParams(params)}`,
    {
      "APCA-API-KEY-ID": env.ALPACA_API_KEY ?? "",
      "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET ?? "",
    },
    ttl,
  );
}
export function finitePrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
export function quoteTime(value: unknown): Date {
  const date = typeof value === "string" ? new Date(value) : new Date(0);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}
export function midpoint(
  bid: number | null,
  ask: number | null,
): number | null {
  // A zero quote is not an executable market; don't turn one side into a midpoint.
  return bid != null && ask != null && bid > 0 && ask > 0 && bid <= ask
    ? (bid + ask) / 2
    : null;
}
