import { guestResponse } from "@/server/guest/http";
import {
  currentProfile,
  portfolioAccess,
  signInRequired,
} from "@/server/auth/access";
import { NextResponse } from "next/server";

import { toNumber } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/server/api/http";
import { portfolioDeleteSchema } from "@/lib/portfolio-delete";
import {
  aggregatePortfolioProjection,
  buildPositionProjection,
} from "@/server/services/projection-service";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: Request, { params }: Params) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  const user = await currentProfile();
  if (!user) return signInRequired();
  const id = (await params).id;
  const input = portfolioDeleteSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success)
    return jsonError("Confirm the portfolio you want to delete.", 400);
  try {
    const portfolio = await prisma.portfolio.findFirst({
      where: { id, userId: user.id },
      select: { name: true },
    });
    if (!portfolio) return jsonError("Portfolio not found.", 404);
    if (portfolio.name !== input.data.name)
      return jsonError(
        "This portfolio was renamed. Reopen it and confirm again.",
        409,
      );
    // The database cascades only this portfolio's holdings, fills and ledger.
    // Recheck owner and name in the atomic delete to cover concurrent changes.
    const result = await prisma.portfolio.deleteMany({
      where: { id, userId: user.id, name: input.data.name },
    });
    if (!result.count)
      return jsonError("This portfolio changed. Refresh and try again.", 409);
    return NextResponse.json({ deletedId: id });
  } catch {
    return jsonError("Unable to delete this portfolio. Please try again.", 500);
  }
}

export async function GET(request: Request, { params }: Params) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  const denied = await portfolioAccess((await params).id);
  if (denied) return denied;
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

export async function PATCH(request: Request, { params }: Params) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  const id = (await params).id;
  const denied = await portfolioAccess(id);
  if (denied) return denied;
  let body: { name?: unknown };
  try {
    body = await request.json();
    if (!body || typeof body !== "object")
      return jsonError("Provide a portfolio name.", 400);
  } catch {
    return jsonError("Invalid request body.", 400);
  }
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.trim().length > 80
  )
    return jsonError("Use a portfolio name between 1 and 80 characters.", 400);
  const portfolio = await prisma.portfolio.update({
    where: { id },
    data: { name: body.name.trim() },
  });
  return NextResponse.json({
    portfolio: { id: portfolio.id, name: portfolio.name },
  });
}
