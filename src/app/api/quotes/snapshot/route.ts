import { AssetClass } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { jsonError } from "@/server/api/http";
import { getQuoteResult } from "@/server/services/quote-service";

import { dataStatus } from "@/server/services/quote-status";
import { closedSessionEligibility } from "@/server/services/closed-session-simulation";
import type { QuoteStatus } from "@/lib/quote-status";
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
    let result = await getQuoteResult(symbol, assetClassRaw);
    let availability: QuoteStatus = dataStatus(symbol, assetClassRaw, result);
    if (
      availability.code === "STALE" &&
      assetClassRaw === "EQUITY" &&
      result.quote?.source === "alpaca-iex"
    ) {
      const refreshed = await getQuoteResult(symbol, assetClassRaw, true);
      result = refreshed.quote
        ? refreshed
        : { quote: result.quote, refreshFailed: true };
      availability = dataStatus(symbol, assetClassRaw, result);
      if (
        !result.refreshFailed &&
        result.quote &&
        availability.code === "STALE"
      ) {
        const eligibility = await closedSessionEligibility(result.quote);
        if (eligibility.basis)
          availability = {
            code: "CLOSED_LIMIT",
            label: "Regular session closed",
            message:
              "Use the last available quote for a simulated limit order.",
            blocking: false,
            connectionRequired: false,
            closedSession: eligibility.basis,
          };
        else if (eligibility.reason)
          availability = { ...availability, message: eligibility.reason };
      }
    }
    const { quote } = result;
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
