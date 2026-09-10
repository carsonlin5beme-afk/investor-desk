import { AssetClass } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { jsonError } from "@/server/api/http";
import { getQuoteResult } from "@/server/services/quote-service";

import { dataStatus } from "@/server/services/quote-status";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams
    .get("symbol")
    ?.trim()
    .toUpperCase();
  const assetClassRaw = request.nextUrl.searchParams
    .get("assetClass")
    ?.trim()
    .toUpperCase();

  if (!symbol || !assetClassRaw) {
    return jsonError(
      "symbol and assetClass query parameters are required",
      400,
    );
  }

  if (
    assetClassRaw !== AssetClass.EQUITY &&
    assetClassRaw !== AssetClass.OPTION
  ) {
    return jsonError("assetClass must be EQUITY or OPTION", 400);
  }

  try {
    const result = await getQuoteResult(symbol, assetClassRaw);
    const { quote } = result;
    const availability = dataStatus(symbol, assetClassRaw, result);
    if (!quote) {
      return NextResponse.json({ quote: null, availability });
    }

    return NextResponse.json({
      availability,
      quote: {
        symbol: quote.symbol,
        assetClass: quote.assetClass,
        bid: quote.bid,
        ask: quote.ask,
        last: quote.last,
        mark: quote.mark,
        source: quote.source,
        asOf: quote.asOf.toISOString(),
      },
    });
  } catch (error) {
    console.error(error);
    return jsonError("Failed to load quote snapshot", 500);
  }
}
