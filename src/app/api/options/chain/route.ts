import { isQuoteStale } from "@/server/domain/staleness";
import { env } from "@/lib/env";
import { OptionRight } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { jsonError } from "@/server/api/http";
import { providers } from "@/server/providers/factory";

import { optionsSetupIssue } from "@/server/services/quote-status";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams
    .get("symbol")
    ?.trim()
    .toUpperCase();
  const expiration = request.nextUrl.searchParams.get("expiration")?.trim();
  const right = request.nextUrl.searchParams.get("right")?.trim().toUpperCase();

  if (!symbol || !expiration) {
    return jsonError(
      "symbol and expiration query parameters are required",
      400,
    );
  }

  if (right && right !== OptionRight.CALL && right !== OptionRight.PUT) {
    return jsonError("right must be CALL or PUT", 400);
  }

  const availability = optionsSetupIssue(symbol);
  if (availability)
    return NextResponse.json({ symbol, contracts: [], availability });
  try {
    const contracts = await providers.options.getOptionChain(
      symbol,
      expiration,
    );
    const filtered = right
      ? contracts.filter((contract) => contract.right === right)
      : contracts;

    return NextResponse.json({
      symbol,
      expiration,
      contracts: filtered
        .sort((a, b) => a.strike - b.strike)
        .map((contract) => ({
          source: contract.source,
          asOf: contract.asOf?.toISOString() ?? null,
          stale:
            /delayed|indicative/.test(contract.source ?? "") ||
            !contract.asOf ||
            isQuoteStale(contract.asOf, env.QUOTE_STALE_SECONDS),
          contractSymbol: contract.contractSymbol,
          underlying: contract.underlying,
          right: contract.right,
          strike: contract.strike,
          expiration: contract.expiration.toISOString(),
          bid: contract.bid,
          ask: contract.ask,
          last: contract.last,
          mark: contract.mark,
          impliedVolatility: contract.impliedVolatility,
        })),
    });
  } catch (error) {
    console.error(error);
    return jsonError(
      error instanceof Error && error.message.startsWith("Schwab:")
        ? error.message
        : "Failed to load option chain",
      500,
    );
  }
}
