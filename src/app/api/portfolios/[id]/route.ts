import { NextResponse } from "next/server";

import { toNumber } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/server/api/http";
import {
  aggregatePortfolioProjection,
  buildPositionProjection,
} from "@/server/services/projection-service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: (await params).id },
      include: {
        positions: {
          include: {
            optionDetails: true,
            targetScenario: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!portfolio) {
      return jsonError("Portfolio not found", 404);
    }

    const positions = await Promise.all(
      portfolio.positions.map((position) => buildPositionProjection(position)),
    );

    let equitiesValue = 0;
    let optionsValue = 0;
    for (const item of positions) {
      if (item.assetClass === "EQUITY") {
        equitiesValue += item.currentMarketValue;
      } else {
        optionsValue += item.currentMarketValue;
      }
    }

    const cashBalance = toNumber(portfolio.cashBalance);
    const totals = aggregatePortfolioProjection(cashBalance, positions);

    return NextResponse.json({
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
        baseCurrency: portfolio.baseCurrency,
        startingCash: toNumber(portfolio.startingCash),
        cashBalance,
        equitiesValue,
        optionsValue,
        currentValue: cashBalance + equitiesValue + optionsValue,
        projectedNetWorth: totals.projectedNetWorth,
        projectedPositionsTotal: totals.projectedPositionsTotal,
      },
      positions,
    });
  } catch (error) {
    console.error(error);
    return jsonError("Failed to load portfolio", 500);
  }
}
