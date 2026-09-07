import { TargetMode } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { toDecimal } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/server/api/http";
import { targetScenarioSchema } from "@/server/api/schemas";
import { providers } from "@/server/providers/factory";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const parsed = targetScenarioSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonError("Invalid target payload", 400, parsed.error.flatten());
    }

    const payload = parsed.data;
    const position = await prisma.position.findUnique({
      where: { id: (await params).id },
      include: { optionDetails: true },
    });

    if (!position) {
      return jsonError("Position not found", 404);
    }

    const underlying =
      position.assetClass === "OPTION"
        ? (position.optionDetails?.underlying ?? position.symbol)
        : position.symbol;

    let liveSharesOutstanding: number | null = null;
    if (
      payload.targetMode === TargetMode.MARKET_CAP &&
      !payload.useManualShares
    ) {
      liveSharesOutstanding = await providers.fundamentals
        .getSharesOutstanding(underlying)
        .catch((error) => {
          console.error("shares outstanding lookup failed", error);
          return null;
        });
    }

    if (
      payload.targetMode === TargetMode.MARKET_CAP &&
      !(payload.useManualShares
        ? payload.sharesOutstandingManual
        : liveSharesOutstanding)
    )
      return jsonError(
        "Shares outstanding unavailable. Enable the manual override and enter a positive share count.",
        400,
      );
    const updated = await prisma.targetScenario.upsert({
      where: { positionId: (await params).id },
      create: {
        positionId: (await params).id,
        targetMode: payload.targetMode,
        targetPrice:
          payload.targetPrice != null ? toDecimal(payload.targetPrice) : null,
        targetMarketCap: payload.targetMarketCap
          ? toDecimal(payload.targetMarketCap)
          : null,
        sharesOutstandingLive: liveSharesOutstanding
          ? toDecimal(liveSharesOutstanding)
          : null,
        sharesOutstandingManual: payload.sharesOutstandingManual
          ? toDecimal(payload.sharesOutstandingManual)
          : null,
        useManualShares: payload.useManualShares ?? false,
      },
      update: {
        targetMode: payload.targetMode,
        targetPrice:
          payload.targetPrice != null ? toDecimal(payload.targetPrice) : null,
        targetMarketCap: payload.targetMarketCap
          ? toDecimal(payload.targetMarketCap)
          : null,
        sharesOutstandingLive: liveSharesOutstanding
          ? toDecimal(liveSharesOutstanding)
          : null,
        sharesOutstandingManual: payload.sharesOutstandingManual
          ? toDecimal(payload.sharesOutstandingManual)
          : null,
        useManualShares: payload.useManualShares ?? false,
      },
    });

    return NextResponse.json({ targetScenario: updated });
  } catch (error) {
    console.error(error);
    return jsonError("Failed to update target scenario", 500);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  await prisma.targetScenario.deleteMany({
    where: { positionId: (await params).id },
  });
  return NextResponse.json({ ok: true });
}
