import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildPositionProjection,
  aggregatePortfolioProjection,
} from "@/server/services/projection-service";
import { isDemo, optionsConfigured } from "@/server/providers/factory";
import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const rows = await prisma.portfolio.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        positions: {
          include: { optionDetails: true, targetScenario: true },
          orderBy: { createdAt: "asc" },
        },
        orders: {
          take: 80,
          orderBy: { submittedAt: "desc" },
          include: { fills: true },
        },
        cashLedgerEntries: { take: 80, orderBy: { createdAt: "desc" } },
      },
    });
    const portfolios = await Promise.all(
      rows.map(async (p) => {
        const positions = await Promise.all(
          p.positions.map(async (position) => ({
            ...position,
            quantity: position.quantity.toNumber(),
            avgCost: position.avgCost.toNumber(),
            projection: await buildPositionProjection(position),
          })),
        );
        const cashBalance = p.cashBalance.toNumber();
        const equitiesValue = positions
          .filter((x) => x.assetClass === "EQUITY")
          .reduce((s, p) => s + p.projection.currentMarketValue, 0);
        const optionsValue = positions
          .filter((x) => x.assetClass === "OPTION")
          .reduce((s, p) => s + p.projection.currentMarketValue, 0);
        return {
          id: p.id,
          name: p.name,
          cashBalance,
          startingCash: p.startingCash.toNumber(),
          currentValue: cashBalance + equitiesValue + optionsValue,
          equitiesValue,
          optionsValue,
          ...aggregatePortfolioProjection(
            cashBalance,
            positions.map((x) => x.projection),
          ),
          positions,
          orders: p.orders,
          ledger: p.cashLedgerEntries,
        };
      }),
    );
    return NextResponse.json({
      portfolios,
      mode: isDemo ? "demo" : "live",
      feeds: {
        equities: Boolean(env.ALPACA_API_KEY && env.ALPACA_API_SECRET),
        options: optionsConfigured(),
        optionsProvider: env.OPTIONS_PROVIDER,
        fundamentals: Boolean(env.ALPHAVANTAGE_API_KEY),
        equityFeed: env.ALPACA_FEED,
      },
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[desk]", error);
    return NextResponse.json(
      {
        error:
          "Database unavailable. Run npm run local:start and check npm run local:status.",
      },
      { status: 503 },
    );
  }
}
