import { NextRequest, NextResponse } from "next/server";
import { providers, isDemo } from "@/server/providers/factory";
const cache = new Map<
  string,
  { shares: number | null; fetchedAt: string; expires: number }
>();
export async function GET(request: NextRequest) {
  const symbol = (
    request.nextUrl.searchParams.get("symbol") ?? ""
  ).toUpperCase();
  if (!/^[A-Z0-9.-]{1,15}$/.test(symbol))
    return NextResponse.json({ error: "Use a valid ticker." }, { status: 400 });
  try {
    let result = cache.get(symbol);
    if (!result || result.expires < Date.now()) {
      result = {
        shares: await providers.fundamentals.getSharesOutstanding(symbol),
        fetchedAt: new Date().toISOString(),
        expires: Date.now() + 3600000,
      };
      if (cache.size > 500) cache.clear();
      cache.set(symbol, result);
    }
    return NextResponse.json({
      shares: result.shares,
      fetchedAt: result.fetchedAt,
      source: isDemo
        ? "Illustrative sample fundamentals"
        : "Alpha Vantage reference data",
      sample: isDemo,
    });
  } catch {
    return NextResponse.json({
      shares: null,
      source: "Unavailable",
      error: "Company fundamentals are unavailable. Use a manual share count.",
    });
  }
}
