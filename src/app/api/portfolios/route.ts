import { guestResponse } from "@/server/guest/http";
import { currentProfile, signInRequired } from "@/server/auth/access";
import { CashEntryType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { toDecimal, toNumber } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/server/api/http";
import { createPortfolioSchema } from "@/server/api/schemas";
import {
  aggregatePortfolioProjection,
  buildPositionProjection,
  PositionProjection,
} from "@/server/services/projection-service";

const summarizeByAssetClass = (positions: PositionProjection[]) => {
  let equities = 0;
  let options = 0;

  for (const position of positions) {
    if (position.assetClass === "EQUITY") {
      equities += position.currentMarketValue;
    } else {
      options += position.currentMarketValue;
    }
  }

  return { equities, options };
};

export async function GET(request: Request) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  try {
    const user = await currentProfile();
    if (!user) return NextResponse.json({ user: null, portfolios: [] });
    const portfolios = await prisma.portfolio.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      include: {
        positions: {
          include: {
            targetScenario: true,
            optionDetails: true,
          },
        },
      },
    });

    const payload = await Promise.all(
      portfolios.map(async (portfolio) => {
        const projections = await Promise.all(
          portfolio.positions.map((position) =>
            buildPositionProjection(position),
          ),
        );
        const byClass = summarizeByAssetClass(projections);
        const cashBalance = toNumber(portfolio.cashBalance);
        const currentTotal = cashBalance + byClass.equities + byClass.options;
        const projectionTotals = aggregatePortfolioProjection(
          cashBalance,
          projections,
        );

        return {
          id: portfolio.id,
          name: portfolio.name,
          baseCurrency: portfolio.baseCurrency,
          startingCash: toNumber(portfolio.startingCash),
          cashBalance,
          currentValue: currentTotal,
          equitiesValue: byClass.equities,
          optionsValue: byClass.options,
          projectedNetWorth: projectionTotals.projectedNetWorth,
          projectedPositionsTotal: projectionTotals.projectedPositionsTotal,
          positionCount: portfolio.positions.length,
        };
      }),
    );

    return NextResponse.json({ portfolios: payload });
  } catch (error) {
    console.error(error);
    return jsonError("Failed to list portfolios", 500);
  }
}

export async function POST(request: NextRequest) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  try {
    const user = await currentProfile();
    if (!user) return signInRequired();
    const body = await request.json();
    const parsed = createPortfolioSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        "Invalid portfolio payload",
        400,
        parsed.error.flatten(),
      );
    }

    const data = parsed.data;

    const created = await prisma.$transaction(async (tx) => {
      const portfolio = await tx.portfolio.create({
        data: {
          userId: user.id,
          name: data.name,
          baseCurrency: data.baseCurrency,
          startingCash: toDecimal(data.startingCash),
          cashBalance: toDecimal(data.startingCash),
        },
      });

      await tx.cashLedgerEntry.create({
        data: {
          portfolioId: portfolio.id,
          type: CashEntryType.DEPOSIT,
          amount: toDecimal(data.startingCash),
          note: "Initial funding",
        },
      });

      return portfolio;
    });

    return NextResponse.json(
      {
        portfolio: {
          id: created.id,
          name: created.name,
          baseCurrency: created.baseCurrency,
          startingCash: toNumber(created.startingCash),
          cashBalance: toNumber(created.cashBalance),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return jsonError("Invalid JSON payload", 400);
    console.error(error);
    return jsonError("Failed to create portfolio", 500);
  }
}
