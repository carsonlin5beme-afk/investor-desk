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
            targetScenario: true,
            optionDetails: true,
          },
        },
      },
    });

    if (!portfolio) {
      return jsonError("Portfolio not found", 404);
    }

    const cashBalance = toNumber(portfolio.cashBalance);
    const positionProjections = await Promise.all(
      portfolio.positions.map((position) => buildPositionProjection(position)),
    );

    const totals = aggregatePortfolioProjection(
      cashBalance,
      positionProjections,
    );

    return NextResponse.json({
      portfolioId: portfolio.id,
      cashBalance,
      projectedNetWorth: totals.projectedNetWorth,
      projectedPositionsTotal: totals.projectedPositionsTotal,
      positions: positionProjections,
    });
  } catch (error) {
    console.error(error);
    return jsonError("Failed to compute projection", 500);
  }
}
