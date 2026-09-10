import { guestResponse, guestStatus } from "@/server/guest/http";
import { currentProfile } from "@/server/auth/access";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildPositionProjection,
  aggregatePortfolioProjection,
} from "@/server/services/projection-service";
import {
  isDemo,
  equitiesConfigured,
  equityFeedConfigured,
  optionsConfigured,
} from "@/server/providers/factory";
import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  try {
    const user = await currentProfile();
    const rows = user
      ? await prisma.portfolio.findMany({
          where: { userId: user.id },
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
        })
      : [];
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
      pendingGuest: user ? await guestStatus() : null,
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
      portfolios,
      mode: isDemo ? "demo" : "live",
      feeds: {
        equities: equitiesConfigured(),
        options: optionsConfigured(),
        optionsProvider: env.OPTIONS_PROVIDER,
        fundamentals: Boolean(env.ALPHAVANTAGE_API_KEY),
        equityFeed: equityFeedConfigured(),
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
