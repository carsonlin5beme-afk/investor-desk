import { guestResponse } from "@/server/guest/http";
import { portfolioAccess } from "@/server/auth/access";
import { NextRequest, NextResponse } from "next/server";

import { toNumber } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/server/api/http";
import { buildPositionProjection } from "@/server/services/projection-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const temporary = await guestResponse(request);
  if (temporary) return temporary;
  try {
    const portfolioId = request.nextUrl.searchParams.get("portfolioId");
    if (!portfolioId) {
      return jsonError("portfolioId query parameter is required");
    }

    const denied = await portfolioAccess(portfolioId);
    if (denied) return denied;
    const positions = await prisma.position.findMany({
      where: { portfolioId },
      include: {
        optionDetails: true,
        targetScenario: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const projectionRows = await Promise.all(
      positions.map((position) => buildPositionProjection(position)),
    );

    return NextResponse.json({
      positions: positions.map((position, idx) => ({
        id: position.id,
        portfolioId: position.portfolioId,
        assetClass: position.assetClass,
        symbol: position.symbol,
        quantity: toNumber(position.quantity),
        avgCost: toNumber(position.avgCost),
        targetScenario: position.targetScenario,
        optionDetails: position.optionDetails,
        projection: projectionRows[idx],
      })),
    });
  } catch (error) {
    console.error(error);
    return jsonError("Failed to load positions", 500);
  }
}
